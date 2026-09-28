import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import type { QuestionFindingsGroup } from "../types/suggestion.js";

/** 지적이 있는 발문만 묶어서 반환한다 (지적 없는 발문은 개선안 대상이 아님). */
export function groupFindingsByQuestion(
  questions: ClassifiedQuestion[],
  findings: QuestioningFinding[]
): QuestionFindingsGroup[] {
  const byIndex = new Map<number, QuestioningFinding[]>();

  for (const f of findings) {
    if (f.targetQuestionIndex === null) continue; // 직전 교사 발화가 없는 드문 경우 — 건너뜀
    const list = byIndex.get(f.targetQuestionIndex) ?? [];
    list.push(f);
    byIndex.set(f.targetQuestionIndex, list);
  }

  return questions
    .filter((q) => byIndex.has(q.segment.index))
    .map((q) => ({ question: q, findings: byIndex.get(q.segment.index)! }));
}
