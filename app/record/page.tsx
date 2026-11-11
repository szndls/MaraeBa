"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { hasVoiceSample, saveVoiceSample, getVoiceSampleBlob } from "../lib/voiceSample.client.js";
import { saveLesson } from "../lib/lessonStore.client.js";
import type { AnalysisResult } from "../../src/types/analysis.js";

// 녹음 화면의 단계: 확인 중 → (처음이면) 내 목소리 녹음 → 수업 녹음 준비 → 녹음 중 → 분석 중
type Step = "checking" | "voice" | "voiceRecording" | "ready" | "lessonRecording" | "analyzing" | "error";

const VOICE_SECONDS = 8;
// Vercel 요청 본문 한도(4.5MB)보다 조금 낮게 잡은 업로드 허용 크기
const MAX_LESSON_AUDIO_BYTES = 4 * 1024 * 1024;

/** 브라우저가 지원하는 녹음 형식 고르기 (크롬: webm, 사파리: mp4) */
function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/** 마이크로 녹음을 시작하고, stop()을 부르면 녹음 파일(Blob)을 돌려주는 도우미 */
async function startRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMime();
  // 16kbps: Vercel 요청 크기 제한(4.5MB) 안에 더 긴 녹음이 들어가게 낮춤
  const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, audioBitsPerSecond: 16000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  rec.start(1000);
  const stop = () =>
    new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
  return { stop };
}

const fileName = (blob: Blob, base: string) => base + (blob.type.includes("mp4") ? ".mp4" : ".webm");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function RecordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("checking");
  const [seconds, setSeconds] = useState(0);
  const [grade, setGrade] = useState(3);
  const [error, setError] = useState<{ msg: string; detail?: string } | null>(null);
  const recorder = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 처음 들어오면: 목소리 샘플이 이미 저장돼 있는지 확인 → 있으면 목소리 녹음 건너뛰기
  useEffect(() => {
    try {
      const g = Number(localStorage.getItem("balmun-grade"));
      if (g >= 1 && g <= 6) setGrade(g);
    } catch {}
    hasVoiceSample()
      .then((exists) => setStep(exists ? "ready" : "voice"))
      .catch(() => setStep("voice"));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function fail(msg: string, detail?: string) {
    setError({ msg, detail });
    setStep("error");
  }

  // 내 목소리 8초 녹음 → 자동으로 멈추고 브라우저(IndexedDB)에 저장
  async function recordVoice() {
    try {
      const r = await startRecorder();
      setStep("voiceRecording");
      setSeconds(VOICE_SECONDS);
      let left = VOICE_SECONDS;
      timer.current = setInterval(async () => {
        left -= 1;
        setSeconds(left);
        if (left <= 0) {
          clearInterval(timer.current!);
          const blob = await r.stop();
          try {
            await saveVoiceSample(blob);
            setStep("ready");
          } catch {
            fail("목소리를 저장하지 못했어요. 다시 시도해 주세요.");
          }
        }
      }, 1000);
    } catch {
      fail("마이크를 쓸 수 없어요. 브라우저 주소창 왼쪽에서 마이크 권한을 허용해 주세요.");
    }
  }

  // 수업 녹음 시작
  async function startLesson() {
    try {
      localStorage.setItem("balmun-grade", String(grade));
    } catch {}
    try {
      recorder.current = await startRecorder();
      setStep("lessonRecording");
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      fail("마이크를 쓸 수 없어요. 브라우저 주소창 왼쪽에서 마이크 권한을 허용해 주세요.");
    }
  }

  // 수업 녹음 끝 → 자동으로 분석 → 끝나면 보고서 화면으로 이동
  async function finishLesson() {
    if (!recorder.current) return;
    if (timer.current) clearInterval(timer.current);
    const blob = await recorder.current.stop();

    if (blob.size > MAX_LESSON_AUDIO_BYTES) {
      const mb = (blob.size / (1024 * 1024)).toFixed(1);
      return fail(`녹음이 너무 길어요 (${mb}MB). 더 짧게 녹음해 주세요.`);
    }

    const voiceBlob = await getVoiceSampleBlob();
    if (!voiceBlob) return fail("내 목소리 샘플이 없어요. 먼저 목소리를 녹음해 주세요.");

    setStep("analyzing");
    const form = new FormData();
    form.append("audio", blob, fileName(blob, "lesson"));
    form.append("voiceSample", voiceBlob, fileName(voiceBlob, "voice"));
    form.append("grade", String(grade));
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) return fail(data.error ?? "분석 중 오류가 났어요.", data.detail);
      const analysis = data as AnalysisResult;
      await saveLesson(analysis.sourceFile, analysis);
      router.push(`/lesson/${analysis.sourceFile}?new=1`);
    } catch {
      fail("서버에 연결하지 못했어요. 터미널에서 npm run dev 가 켜져 있는지 확인해 주세요.");
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col items-center justify-center px-4 pb-20 text-center">
      {step === "checking" && <p className="text-stone-400">준비하는 중…</p>}

      {(step === "voice" || step === "voiceRecording") && (
        <>
          <p className="mb-2 text-sm font-semibold text-chalk">처음 한 번만</p>
          <h1 className="text-3xl font-bold">내 목소리 녹음하기</h1>
          <p className="mt-3 text-stone-500">
            선생님 목소리와 학생 목소리를 구분하는 데 써요.
            <br />
            수업할 때처럼 {VOICE_SECONDS}초 동안 아무 말이나 해 주세요.
          </p>
          {step === "voice" ? (
            <button onClick={recordVoice} className="mt-10 grid h-28 w-28 place-items-center rounded-full bg-chalk text-4xl text-white shadow-lg transition hover:brightness-110" aria-label="목소리 녹음 시작">
              🎙️
            </button>
          ) : (
            <div className="mt-10 grid h-28 w-28 place-items-center rounded-full bg-rose-500 text-4xl font-bold tabular-nums text-white shadow-lg ring-8 ring-rose-200 animate-pulse">
              {seconds}
            </div>
          )}
          <p className="mt-4 text-sm text-stone-400">{step === "voice" ? "버튼을 누르면 바로 녹음돼요" : "녹음 중… 자동으로 멈춰요"}</p>
        </>
      )}

      {step === "ready" && (
        <>
          <h1 className="text-3xl font-bold">수업 녹음 준비 완료</h1>
          <p className="mt-3 text-stone-500">휴대폰이나 노트북을 교실 가운데에 두고 시작하세요.</p>
          <label className="mt-8 flex items-center gap-3 text-sm font-semibold text-stone-600">
            학년
            <select value={grade} onChange={(e) => setGrade(Number(e.target.value))} className="rounded-xl border border-line bg-white px-3 py-2 font-normal">
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <option key={g} value={g}>{g}학년</option>
              ))}
            </select>
          </label>
          <button onClick={startLesson} className="mt-6 w-full max-w-xs rounded-2xl bg-chalk py-4 text-lg font-bold text-white shadow-sm transition hover:brightness-110">
            수업 녹음 시작하기
          </button>
          <button onClick={() => setStep("voice")} className="mt-4 text-xs text-stone-400 underline-offset-2 hover:underline">
            내 목소리 다시 녹음하기
          </button>
        </>
      )}

      {step === "lessonRecording" && (
        <>
          <div className="mb-6 flex items-center gap-2 text-sm font-semibold text-rose-600">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" /> 수업 녹음 중
          </div>
          <div className="font-mono text-6xl font-bold tabular-nums">{mmss(seconds)}</div>
          <button onClick={finishLesson} className="mt-10 w-full max-w-xs rounded-2xl bg-ink py-4 text-lg font-bold text-white transition hover:opacity-90">
            녹음 끝내고 분석하기
          </button>
        </>
      )}

      {step === "analyzing" && (
        <>
          <div className="mb-6 h-12 w-12 animate-spin rounded-full border-4 border-chalk-soft border-t-chalk" />
          <h1 className="text-2xl font-bold">수업을 분석하는 중이에요</h1>
          <p className="mt-3 text-stone-500">
            받아쓰기 → 개념 찾기 → 발문 진단 → 보고서 순서로 진행돼요.
            <br />몇 분 걸릴 수 있으니 이 화면을 닫지 마세요.
          </p>
        </>
      )}

      {step === "error" && error && (
        <>
          <h1 className="text-2xl font-bold">문제가 생겼어요</h1>
          <p className="mt-3 text-stone-600">{error.msg}</p>
          {error.detail && <pre className="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-100 p-3 text-left text-xs text-stone-500">{error.detail}</pre>}
          <button onClick={() => { setError(null); setStep("checking"); hasVoiceSample().then((exists) => setStep(exists ? "ready" : "voice")); }} className="mt-6 rounded-xl bg-chalk px-5 py-2.5 font-semibold text-white">
            다시 시도
          </button>
        </>
      )}

      <Link href="/" className="mt-12 text-sm text-stone-400 hover:text-chalk">홈으로</Link>
    </main>
  );
}
