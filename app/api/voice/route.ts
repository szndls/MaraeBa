import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { findVoiceSample, recordingsDir, VOICE_BASENAME, extFromMime } from "../../lib/voiceSample.server.js";

// GET: 목소리 샘플이 이미 있는지 알려 준다 (있으면 녹음 단계를 건너뛴다)
export async function GET() {
  return Response.json({ exists: (await findVoiceSample()) !== null });
}

// POST: 브라우저에서 녹음한 8초 목소리를 recordings/ 에 저장한다 (기존 샘플은 교체)
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) return Response.json({ error: "녹음 파일이 없어요." }, { status: 400 });

  const old = await findVoiceSample();
  if (old) await unlink(old).catch(() => {});

  await mkdir(recordingsDir(), { recursive: true });
  const target = path.join(recordingsDir(), VOICE_BASENAME + extFromMime(file.type));
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return Response.json({ ok: true });
}
