import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { transcribeAudio } from "../../../src/input/transcribeAudio.js";
import { loadFromDiarizeResult } from "../../../src/input/loadTranscript.js";
import { analyzeTranscript } from "../../../src/run.js";

// Vercel 서버리스에서 돌아가는 라우트 — child_process 없이 이 함수 안에서 바로
// 받아쓰기(transcribeAudio)부터 분석(analyzeTranscript)까지 끝낸다.
export const runtime = "nodejs";
export const maxDuration = 300;

function extFromMime(mime: string): string {
  return mime.includes("mp4") ? ".mp4" : ".webm";
}

// POST: 수업 녹음 + 목소리 샘플 + 학년을 받아 분석 결과 전체(JSON)를 돌려준다.
// 서버에는 아무것도 남기지 않는다 — 브라우저가 응답을 IndexedDB에 저장한다.
export async function POST(req: Request) {
  const form = await req.formData();
  const lessonAudio = form.get("audio");
  const voiceSample = form.get("voiceSample");
  const grade = Number(form.get("grade"));

  if (!(lessonAudio instanceof File)) return Response.json({ error: "수업 녹음 파일이 없어요." }, { status: 400 });
  if (!(voiceSample instanceof File)) return Response.json({ error: "내 목소리 샘플이 없어요. 먼저 목소리를 녹음해 주세요." }, { status: 400 });
  if (!(grade >= 1 && grade <= 6)) return Response.json({ error: "학년을 골라 주세요." }, { status: 400 });

  // 이름 예: lesson-20261109-2130 (날짜·시각) — IndexedDB 저장 키로도 쓴다.
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `lesson-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

  const tmpId = crypto.randomUUID();
  const lessonAudioPath = path.join(os.tmpdir(), `${tmpId}-lesson${extFromMime(lessonAudio.type)}`);
  const voiceSamplePath = path.join(os.tmpdir(), `${tmpId}-voice${extFromMime(voiceSample.type)}`);

  await writeFile(lessonAudioPath, Buffer.from(await lessonAudio.arrayBuffer()));
  await writeFile(voiceSamplePath, Buffer.from(await voiceSample.arrayBuffer()));

  try {
    const rawResponse = await transcribeAudio({ audioFilePath: lessonAudioPath, teacherSampleFilePath: voiceSamplePath });
    const transcript = loadFromDiarizeResult(rawResponse, grade);
    const analysis = await analyzeTranscript(transcript, name);
    return Response.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "분석 중 오류가 났어요.", detail: message }, { status: 500 });
  } finally {
    await unlink(lessonAudioPath).catch(() => {});
    await unlink(voiceSamplePath).catch(() => {});
  }
}
