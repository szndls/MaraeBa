import type { QuestioningFinding } from "../types/questioning.js";

/**
 * 지적마다 고정된 id를 만든다: "기준:발문번호:반응발화번호". 배열 위치가 아니라
 * 그 지적이 가리키는 실제 발화 index로 만들기 때문에, 같은 전사본을 다시 실행해도
 * 같은 지적이면 같은 id가 나온다 — UI가 "이 지적을 무시" 상태를 저장해 뒀다가 다음
 * 실행 결과에도 그대로 적용할 수 있다.
 *
 * 반응발화번호는 Q6·Q7·Q8처럼 targetReactionSegmentIndex가 있으면 그 값을 쓰고,
 * 없으면 그 지적이 실제로 걸린 마지막 세그먼트(자문자답의 답변 발화, 대기시간 지적의
 * 다음 발화 등)를 쓴다 — 어느 쪽이든 "이 지적이 정확히 어떤 발화를 가리키는지"를
 * 안정적으로 담는다.
 */
export function computeFindingId(finding: QuestioningFinding): string {
  const questionPart = finding.targetQuestionIndex ?? "null";
  const lastSegmentIndex = finding.segments[finding.segments.length - 1]?.index;
  const reactionPart = finding.targetReactionSegmentIndex ?? lastSegmentIndex ?? finding.targetQuestionIndex ?? "null";
  return `${finding.criterionId}:${questionPart}:${reactionPart}`;
}
