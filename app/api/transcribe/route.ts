import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { transcribeAudio } from "../../../src/input/transcribeAudio.js";
import { loadFromDiarizeResult } from "../../../src/input/loadTranscript.js";

// Vercel 서버리스 — 긴 수업을 10분 단위 "조각"으로 끊어 녹음했을 때, 조각 하나를
// 받아쓰기만 한다(분석은 안 함). 여러 조각의 결과를 브라우저가 합쳐서 /api/analyze로 보낸다.
export const runtime = "nodejs";
export const maxDuration = 300;

function extFromMime(mime: string): string {
  return mime.includes("mp4") ? ".mp4" : ".webm";
}

// POST: 녹음 조각 + 목소리 샘플 + 학년 + 이 조각이 전체 녹음에서 시작하는 시각(초)을
// 받아, 그 시각만큼 start/end를 더한 세그먼트 배열을 돌려준다 — 시간 계산은 코드가 한다.
export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  const voiceSample = form.get("voiceSample");
  const grade = Number(form.get("grade"));
  const offsetSeconds = Number(form.get("offsetSeconds"));

  if (!(audio instanceof File)) return Response.json({ error: "녹음 조각이 없어요." }, { status: 400 });
  if (!(voiceSample instanceof File)) return Response.json({ error: "내 목소리 샘플이 없어요." }, { status: 400 });
  if (!(grade >= 1 && grade <= 6)) return Response.json({ error: "학년을 골라 주세요." }, { status: 400 });
  if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
    return Response.json({ error: "조각 시작 시각이 올바르지 않아요." }, { status: 400 });
  }

  const tmpId = crypto.randomUUID();
  const audioPath = path.join(os.tmpdir(), `${tmpId}-chunk${extFromMime(audio.type)}`);
  const voiceSamplePath = path.join(os.tmpdir(), `${tmpId}-voice${extFromMime(voiceSample.type)}`);

  await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));
  await writeFile(voiceSamplePath, Buffer.from(await voiceSample.arrayBuffer()));

  try {
    const rawResponse = await transcribeAudio({ audioFilePath: audioPath, teacherSampleFilePath: voiceSamplePath });
    const transcript = loadFromDiarizeResult(rawResponse, grade);
    const segments = transcript.segments.map((s) => ({
      ...s,
      start: s.start + offsetSeconds,
      end: s.end + offsetSeconds,
    }));
    return Response.json({ segments });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "받아쓰기 중 오류가 났어요.", detail: message }, { status: 500 });
  } finally {
    await unlink(audioPath).catch(() => {});
    await unlink(voiceSamplePath).catch(() => {});
  }
}
