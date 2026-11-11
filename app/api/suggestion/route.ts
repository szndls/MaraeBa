import { generateImprovements } from "../../../src/suggestions/generateImprovements.js";
import type { NormalizedTranscript } from "../../../src/types/transcript.js";
import type { ConceptMatch } from "../../../src/types/concept.js";
import type { ClassifiedQuestion, QuestioningFinding } from "../../../src/types/questioning.js";
import type { WaitTimeEvaluation } from "../../../src/questioning/checkWaitTime.js";

// Vercel 서버리스 — 보고서에서 교사가 발화를 눌렀을 때, 그 발문 하나의 개선안만 만든다.
// 생성·자동 검사·재생성 로직은 분석 때 쓰던 generateImprovements를 그대로 쓰고,
// 발문 목록에 이 발문 하나만 넣어서 개선안 1개만 나오게 한다.
export const runtime = "nodejs";
export const maxDuration = 120;

interface RequestBody {
  questionIndex?: number;
  question?: ClassifiedQuestion;
  /** 이 발문에 걸린 지적들 (groupFindingsByQuestion으로 묶은 그 발문의 그룹) */
  findings?: QuestioningFinding[];
  /** 전사본 앞부분 — 맨 처음부터 이 발문 다음 발화까지. 자동 검사가 "이 발문 이전에
   *  나온 숫자"와 "바로 다음 발화"를 보기 때문에 그 범위가 필요하다. */
  transcript?: NormalizedTranscript;
  conceptMatch?: ConceptMatch;
  waitTimeEvaluation?: WaitTimeEvaluation | null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (
    !body ||
    typeof body.questionIndex !== "number" ||
    !body.question ||
    !Array.isArray(body.findings) ||
    !body.transcript ||
    !body.conceptMatch
  ) {
    return Response.json({ error: "개선안을 만들 정보가 부족해요." }, { status: 400 });
  }
  if (body.question.segment.index !== body.questionIndex) {
    return Response.json({ error: "발문 번호가 맞지 않아요." }, { status: 400 });
  }

  try {
    const { suggestions } = await generateImprovements(
      body.transcript,
      [body.question],
      body.findings,
      body.conceptMatch,
      body.waitTimeEvaluation ? [body.waitTimeEvaluation] : []
    );
    const suggestion = suggestions.find((s) => s.questionIndex === body.questionIndex) ?? null;
    return Response.json({ suggestion });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "개선안을 만들지 못했어요.", detail: message }, { status: 500 });
  }
}
