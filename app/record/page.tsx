"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { hasVoiceSample, saveVoiceSample, getVoiceSampleBlob } from "../lib/voiceSample.client.js";
import { saveLesson } from "../lib/lessonStore.client.js";
import { startChunkedRecording, type ChunkedRecorder } from "../lib/chunkedRecorder.client.js";
import type { AnalysisResult } from "../../src/types/analysis.js";
import type { NormalizedTranscript, TranscriptSegment } from "../../src/types/transcript.js";

// 녹음 화면의 단계: 확인 중 → (처음이면) 내 목소리 녹음 → 수업 녹음 준비 → 녹음 중 → 분석 중
type Step = "checking" | "voice" | "voiceRecording" | "ready" | "lessonRecording" | "analyzing" | "error";

const VOICE_SECONDS = 8;
// 긴 수업도 지원하려고 이 간격마다 녹음을 조각내서 따로 받아쓴다(화면은 끊김 없이 이어짐)
const CHUNK_SECONDS = 10 * 60;
// Vercel 요청 본문 한도(4.5MB)보다 조금 낮게 잡은 업로드 허용 크기 — 10분 조각은
// 16kbps 기준 약 1.2MB라 평소엔 안 걸리지만, 혹시 모를 긴 조각에 대한 안전장치
const MAX_CHUNK_AUDIO_BYTES = 4 * 1024 * 1024;
// 분석(/api/analyze)이 Vercel 300초 안에 끝나는 최대 수업 길이. 실측: 2.6분 118초,
// 10.6분 251초, 21.1분 438초 — 10분이면 약 240초로 재시도·네트워크 변동 여유가 남는다.
const MAX_RECORDING_MINUTES = 10;
const MAX_RECORDING_SECONDS = MAX_RECORDING_MINUTES * 60;
// 자동 종료 시각과 조각 전환 시각이 겹치면 1초 미만의 빈 조각이 생길 수 있어 건너뛴다(16kbps ≈ 2KB/초)
const MIN_CHUNK_AUDIO_BYTES = 4 * 1024;

/** 브라우저가 지원하는 녹음 형식 고르기 (크롬: webm, 사파리: mp4) */
function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/** 짧은 단발 녹음(목소리 샘플용) — stop()을 부르면 녹음 파일(Blob)을 돌려준다 */
async function startRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMime();
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
  const voiceBusy = useRef(false); // 목소리 녹음이 이미 진행 중인지
  const [grade, setGrade] = useState(3);
  const [error, setError] = useState<{ msg: string; detail?: string } | null>(null);
  const lessonRecorder = useRef<ChunkedRecorder | null>(null);
  const pendingChunks = useRef<Promise<TranscriptSegment[]>[]>([]);
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

  // 최대 녹음 시간이 되면 자동으로 녹음을 끝내고 분석으로 넘어간다
  useEffect(() => {
    if (step === "lessonRecording" && seconds >= MAX_RECORDING_SECONDS) finishLesson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, seconds]);

  function fail(msg: string, detail?: string) {
    setError({ msg, detail });
    setStep("error");
  }

  // 내 목소리 8초 녹음 → 자동으로 멈추고 브라우저(IndexedDB)에 저장
  async function recordVoice() {
    // 버튼을 두 번 누르면 타이머가 두 개 돌아서 시간이 음수로 내려가던 문제 방지
    if (voiceBusy.current) return;
    voiceBusy.current = true;
    try {
      const r = await startRecorder();
      setStep("voiceRecording");
      setSeconds(VOICE_SECONDS);
      let left = VOICE_SECONDS;
      // 이 타이머는 자기 번호(id)로만 멈춘다 — 수업 녹음 타이머를 잘못 멈추지 않도록
      const id = setInterval(async () => {
        left -= 1;
        setSeconds(Math.max(0, left));
        if (left <= 0) {
          clearInterval(id);
          voiceBusy.current = false;
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
      voiceBusy.current = false;
      fail("마이크를 쓸 수 없어요. 브라우저 주소창 왼쪽에서 마이크 권한을 허용해 주세요.");
    }
  }

  // 녹음 조각 하나를 /api/transcribe로 보내 받아쓴다 — 조각이 끝나는 대로(녹음이
  // 계속되는 동안) 백그라운드에서 시작해서, "끝내고 분석하기"를 눌렀을 때 기다리는
  // 시간을 줄인다.
  async function transcribeChunk(blob: Blob, offsetSeconds: number): Promise<TranscriptSegment[]> {
    if (blob.size < MIN_CHUNK_AUDIO_BYTES) return [];
    if (blob.size > MAX_CHUNK_AUDIO_BYTES) {
      const mb = (blob.size / (1024 * 1024)).toFixed(1);
      throw new Error(`녹음 조각이 너무 커요 (${mb}MB).`);
    }
    const voiceBlob = await getVoiceSampleBlob();
    if (!voiceBlob) throw new Error("내 목소리 샘플이 없어요. 먼저 목소리를 녹음해 주세요.");

    const form = new FormData();
    form.append("audio", blob, fileName(blob, "chunk"));
    form.append("voiceSample", voiceBlob, fileName(voiceBlob, "voice"));
    form.append("grade", String(grade));
    form.append("offsetSeconds", String(offsetSeconds));
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail ?? data.error ?? "받아쓰기 중 오류가 났어요.");
    return data.segments as TranscriptSegment[];
  }

  // 수업 녹음 시작 — 하나의 마이크 스트림을 유지하면서 CHUNK_SECONDS마다 조각을 낸다
  async function startLesson() {
    try {
      localStorage.setItem("balmun-grade", String(grade));
    } catch {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingChunks.current = [];
      lessonRecorder.current = startChunkedRecording(stream, pickMime(), CHUNK_SECONDS, (blob, offsetSeconds) => {
        pendingChunks.current.push(transcribeChunk(blob, offsetSeconds));
      });
      setStep("lessonRecording");
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      fail("마이크를 쓸 수 없어요. 브라우저 주소창 왼쪽에서 마이크 권한을 허용해 주세요.");
    }
  }

  // 수업 녹음 끝 → 마지막 조각까지 받아쓴 뒤 전부 합쳐서 분석 1번 실행 → 보고서로 이동
  async function finishLesson() {
    const recorder = lessonRecorder.current;
    if (!recorder) return;
    lessonRecorder.current = null; // 버튼 클릭과 자동 종료가 겹쳐도 한 번만 실행
    if (timer.current) clearInterval(timer.current);
    setStep("analyzing");
    try {
      await recorder.stop(); // 마지막(짧은) 조각도 transcribeChunk 큐에 들어감
      const chunkResults = await Promise.all(pendingChunks.current);
      const segments: TranscriptSegment[] = chunkResults
        .flat()
        .sort((a, b) => a.start - b.start)
        .map((s, index) => ({ ...s, index }));

      if (segments.length === 0) throw new Error("받아쓴 내용이 없어요. 다시 녹음해 주세요.");
      if (!segments.some((s) => s.speaker === "teacher" && s.text.trim() !== "")) {
        throw new Error("녹음에서 선생님 목소리를 찾지 못했어요. 마이크 가까이에서 말하며 다시 녹음해 주세요.");
      }

      const transcript: NormalizedTranscript = {
        meta: { grade, source: "gpt-4o-transcribe-diarize", time_unit: "seconds" },
        segments,
      };

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!res.ok) return fail(data.error ?? "분석 중 오류가 났어요.", data.detail);
      const analysis = data as AnalysisResult;
      await saveLesson(analysis.sourceFile, analysis);
      router.push(`/lesson/${analysis.sourceFile}?new=1`);
    } catch (err) {
      fail(err instanceof Error ? err.message : "서버에 연결하지 못했어요. 터미널에서 npm run dev 가 켜져 있는지 확인해 주세요.");
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
          <p className="mt-2 text-sm font-semibold text-chalk">최대 {MAX_RECORDING_MINUTES}분까지 녹음할 수 있어요</p>
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
          <p className="mt-3 text-xs text-stone-400">
            최대 {MAX_RECORDING_MINUTES}분 — {mmss(Math.max(0, MAX_RECORDING_SECONDS - seconds))} 남으면 자동으로 끝나고 분석해요
          </p>
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
