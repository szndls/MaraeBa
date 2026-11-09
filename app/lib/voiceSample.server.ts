import { readdir } from "node:fs/promises";
import path from "node:path";

// 교사 목소리 샘플은 recordings/teacher-voice-sample.<확장자> 로 한 개만 둔다.
export const recordingsDir = () => path.join(process.cwd(), "recordings");
export const VOICE_BASENAME = "teacher-voice-sample";

/** 저장된 목소리 샘플 파일 경로. 없으면 null */
export async function findVoiceSample(): Promise<string | null> {
  try {
    const files = await readdir(recordingsDir());
    const hit = files.find((f) => f.startsWith(VOICE_BASENAME + "."));
    return hit ? path.join(recordingsDir(), hit) : null;
  } catch {
    return null;
  }
}

/** 브라우저 녹음 형식(audio/webm, audio/mp4)을 파일 확장자로 바꾼다 */
export function extFromMime(mime: string): string {
  return mime.includes("mp4") ? ".mp4" : ".webm";
}
