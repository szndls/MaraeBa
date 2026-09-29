import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import type { QuestionFindingsGroup } from "../types/suggestion.js";

/**
 * Q3(자문자답)의 답변 역할 발화(교사가 스스로 답한 그 발화)에 Q4(유도 발문)가 걸리는
 * 경우가 있다 — 예: "3분의 1이죠?"가 자문자답의 답이면서 동시에 그 자체로 유도 발문
 * 형태이기도 함. 이 경우 Q4를 별도 발문으로 취급해서 개선 발문을 새로 만들면 어색하다
 * (원래 발문 문장은 문제가 아니고, "이 말을 하지 않는 것"이 개선이기 때문).
 * 그래서 그 Q4를 Q3가 걸린 원래 발문 쪽으로 옮기고, mergeNote를 남겨서 5단계가
 * 별도 개선 발문을 만들지 않고 Q3 개선 행동 설명에 녹이도록 한다.
 */
function mergeSelfAnswerLeadingQuestions(findings: QuestioningFinding[]): QuestioningFinding[] {
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
    if (f.criterionId !== "Q4") return f;
    const ownIndex = f.segments[0]?.index;
    if (ownIndex === undefined) return f;
    const questionIndex = selfAnswerToQuestion.get(ownIndex);
    if (questionIndex === undefined) return f;

    return {
      ...f,
      targetQuestionIndex: questionIndex,
      mergeNote:
        "이 Q4는 원래 발문이 아니라 Q3(자문자답)에서 교사가 스스로 답한 발화 자체에 " +
        "해당한다. 별도 개선 발문을 만들지 말고, Q3 개선 행동 설명(이 말을 하지 않기)에 " +
        "이 발화가 왜 유도 발문 형태이기도 한지 이유로 같이 포함시킨다.",
    };
  });
}

/** 지적이 있는 발문만 묶어서 반환한다 (지적 없는 발문은 개선안 대상이 아님). */
export function groupFindingsByQuestion(
  questions: ClassifiedQuestion[],
  findings: QuestioningFinding[]
): QuestionFindingsGroup[] {
  const merged = mergeSelfAnswerLeadingQuestions(findings);

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
