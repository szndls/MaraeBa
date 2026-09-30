import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import type { QuestionFindingsGroup } from "../types/suggestion.js";

const MERGE_NOTES: Record<string, string> = {
  Q4:
    "이 Q4는 원래 발문이 아니라 Q3(자문자답)에서 교사가 스스로 답한 발화 자체에 해당한다. " +
    "그래도 whatAndWhy에는 이 기준만의 항목을 만들어서, 그 자문자답 발화가 왜 유도 " +
    "발문 형태이기도 한지 설명한다. 다만 별도 actions나 revisedQuestionLine은 만들지 " +
    "않는다 — 그 발화 자체를 하지 않는 것(Q3의 개선)이 이 문제도 함께 해소한다.",
  Q5:
    "이 Q5는 원래 발문이 아니라 Q3(자문자답)에서 교사가 스스로 답한 발화 자체에 대한 " +
    "대기시간 지적이다. 이 발화 자체를 하지 않도록(Q3 개선) 제안하면 이 지적도 자연히 " +
    "해소되므로, 별도의 대기시간 조언을 추가할 필요는 없다(코드가 만들지 않음).",
};

/**
 * Q3(자문자답)의 답변 역할 발화(교사가 스스로 답한 그 발화)에 다른 기준(Q4, Q5 등)이
 * 같이 걸리는 경우가 있다 — 예: "3분의 1이죠?"가 자문자답의 답이면서 동시에 그 자체로
 * 유도 발문 형태이기도 하고, 그 다음 발화까지의 대기시간도 짧게 측정됨. 이 경우 그
 * 기준들을 별도 발문으로 취급해서 각자 개선안(별도 revisedQuestionLine·actions)을
 * 만들면 어색하다(원래 발문 문장은 문제가 아니고, "이 말을 하지 않는 것"이 개선이기
 * 때문). 그래서 그 기준들을 Q3가 걸린 원래 발문 쪽으로 옮기고, mergeNote를 남겨서
 * 5단계가 별도 revisedQuestionLine·actions는 만들지 않지만, whatAndWhy 설명은 그
 * 기준 자체의 문제로 여전히 만들도록 한다.
 */
function mergeSelfAnswerFindings(findings: QuestioningFinding[]): QuestioningFinding[] {
  // 자문자답의 답변 발화 index → 원래 발문(질문) index
  const selfAnswerToQuestion = new Map<number, number>();
  for (const f of findings) {
    if (f.criterionId !== "Q3") continue;
    const answerSegment = f.segments[1];
    if (answerSegment && f.targetQuestionIndex !== null) {
      selfAnswerToQuestion.set(answerSegment.index, f.targetQuestionIndex);
    }
  }

  if (selfAnswerToQuestion.size === 0) return findings;

  return findings.map((f) => {
    if (f.criterionId === "Q3") return f; // Q3 자신은 옮길 대상이 아니라 병합 기준점
    const mergeNote = MERGE_NOTES[f.criterionId];
    if (!mergeNote) return f; // 병합 규칙이 없는 기준은 그대로

    const ownIndex = f.segments[0]?.index;
    if (ownIndex === undefined) return f;
    const questionIndex = selfAnswerToQuestion.get(ownIndex);
    if (questionIndex === undefined) return f;

    return { ...f, targetQuestionIndex: questionIndex, mergeNote };
  });
}

/** 지적이 있는 발문만 묶어서 반환한다 (지적 없는 발문은 개선안 대상이 아님). */
export function groupFindingsByQuestion(
  questions: ClassifiedQuestion[],
  findings: QuestioningFinding[]
): QuestionFindingsGroup[] {
  const merged = mergeSelfAnswerFindings(findings);

  const byIndex = new Map<number, QuestioningFinding[]>();
  for (const f of merged) {
    if (f.targetQuestionIndex === null) continue; // 직전 교사 발화가 없는 드문 경우 — 건너뜀
    const list = byIndex.get(f.targetQuestionIndex) ?? [];
    list.push(f);
    byIndex.set(f.targetQuestionIndex, list);
  }

  return questions
    .filter((q) => byIndex.has(q.segment.index))
    .map((q) => ({ question: q, findings: byIndex.get(q.segment.index)! }));
}
