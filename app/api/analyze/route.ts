import { analyzeTranscript } from "../../../src/run.js";
import type { NormalizedTranscript } from "../../../src/types/transcript.js";

// Vercel 서버리스 — 이미 만들어진 전사본(1단계 완료분)을 받아 2~6단계 분석만 실행한다.
// 받아쓰기는 /api/transcribe가 (긴 수업은 조각마다) 맡고, 여기서는 합쳐진 전사본
// 하나로 분석을 한 번만 돌린다.
export const runtime = "nodejs";
export const maxDuration = 300;

interface RequestBody {
  transcript?: NormalizedTranscript;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body?.transcript) {
    return Response.json({ error: "전사본이 없어요." }, { status: 400 });
  }

  // 이름 예: lesson-20261109-2130 (날짜·시각) — IndexedDB 저장 키로도 쓴다.
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `lesson-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

  try {
    const analysis = await analyzeTranscript(body.transcript, name);
    return Response.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "분석 중 오류가 났어요.", detail: message }, { status: 500 });
  }
}
