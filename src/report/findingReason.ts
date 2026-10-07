/**
 * 교사에게 보여줄 지적 이유를 기준별로 한 문장으로 만든다 — 코드 템플릿 + 원문
 * 인용만 쓴다. LLM 원자적 판단의 원문은 QuestioningFinding.devReason에 따로
 * 남기고(개발용), 여기서 만든 문장은 reason 필드로 간다.
 */

function quote(text: string): string {
  return `"${text}"`;
}

export function buildQ1Reason(questionText: string): string {
  return `${quote(questionText)}처럼 한 번에 서로 다른 질문을 여러 개 던져서, 학생이 어느 질문에 먼저 답해야 할지 헷갈릴 수 있어요.`;
}

export function buildQ2Reason(questionText: string): string {
  return `${quote(questionText)}는 무엇을 답해야 하는지 분명하지 않거나, 답을 기대하지 않고 습관적으로 쓰는 말이에요.`;
}

export function buildQ3Reason(questionText: string, selfAnswerText: string): string {
  return `${quote(questionText)}라고 묻고, 학생이 답하기 전에 교사가 스스로 ${quote(selfAnswerText)}라고 답해서 학생이 생각할 기회를 갖지 못했어요.`;
}

export function buildQ4Reason(questionText: string): string {
  return `${quote(questionText)}는 정답을 이미 알려주면서 예·아니오로만 확인하는 질문이라, 학생이 스스로 생각할 필요가 없었어요.`;
}

export function buildQ5Reason(waitTimeSec: number, questionType: string): string {
  return `발문 후 ${waitTimeSec.toFixed(1)}초 만에 다음 발화가 시작돼서, "${questionType}" 발문에 필요한 생각할 시간이 부족했어요.`;
}

export function buildQ6Reason(reactionText: string): string {
  return `${quote(reactionText)}로 평가만 하고, 이유를 묻거나 다른 친구와 연결하지 않은 채 다음으로 넘어갔어요.`;
}

export function buildQ7Reason(studentAnswerText: string, reactionText: string): string {
  return `학생이 ${quote(studentAnswerText)}라고 틀리게 답했는데, 왜 그렇게 생각했는지 묻지 않고 ${quote(reactionText)}로 정답을 바로 알려줬어요.`;
}

export function buildQ8Reason(reactionText: string): string {
  return `${quote(reactionText)}처럼 무엇이 좋았는지 말하지 않고 막연하게 칭찬했어요.`;
}

export function buildQ9Reason(questionText: string): string {
  return `${quote(questionText)}처럼 학생 이름을 먼저 부르고 질문해서, 다른 학생들이 생각을 멈출 수 있어요.`;
}
