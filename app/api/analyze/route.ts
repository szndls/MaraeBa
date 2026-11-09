import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { findVoiceSample, recordingsDir, extFromMime } from "../../lib/voiceSample.server.js";

const run = promisify(execFile);

// 터미널에서 쓰던 명령(npm run transcribe / npm run analyze)을 서버가 대신 실행한다.
// 이렇게 하면 이미 검증된 분석 코드를 한 줄도 바꾸지 않고 화면에 연결할 수 있다.
async function runScript(script: string, args: string[]) {
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  return run(tsx, [script, ...args], { cwd: process.cwd(), env: process.env, maxBuffer: 20 * 1024 * 1024, timeout: 15 * 60 * 1000 });
}

// POST: 수업 녹음 + 학년을 받아 1~6단계를 돌리고, 결과 이름을 돌려준다
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("audio");
  const grade = Number(form.get("grade"));
  if (!(file instanceof File)) return Response.json({ error: "수업 녹음 파일이 없어요." }, { status: 400 });
  if (!(grade >= 1 && grade <= 6)) return Response.json({ error: "학년을 골라 주세요." }, { status: 400 });

  const voice = await findVoiceSample();
  if (!voice) return Response.json({ error: "내 목소리 샘플이 없어요. 먼저 목소리를 녹음해 주세요." }, { status: 400 });

  // 이름 예: lesson-20261109-2130 (날짜·시각)
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `lesson-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

  await mkdir(recordingsDir(), { recursive: true });
  const audioPath = path.join(recordingsDir(), name + extFromMime(file.type));
  await writeFile(audioPath, Buffer.from(await file.arrayBuffer()));

  try {
    await runScript("src/transcribe.ts", [audioPath, voice, String(grade), name]);
    await runScript("src/run.ts", [path.join("output", "transcripts", `${name}.json`)]);
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = extractErrorDetail(e.stderr || e.message || "");
    return Response.json({ error: "분석 중 오류가 났어요.", detail }, { status: 500 });
  }
  return Response.json({ name });
}

// 자식 프로세스 stderr에서 사람이 읽을 메시지만 뽑는다: "Error:" 뒤에 오는 실제 이유를
// 찾고(스택 추적·에러 객체 속성이 뒤에 더 있어도 무시), 못 찾으면 첫 줄을 쓴다.
function extractErrorDetail(stderr: string): string {
  const marker = "Error:";
  const idx = stderr.indexOf(marker);
  if (idx !== -1) {
    const line = stderr.slice(idx + marker.length).split("\n")[0].trim();
    if (line) return line;
  }
  return stderr.split("\n").find((l) => l.trim())?.trim() ?? "";
}
