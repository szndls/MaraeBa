import type { ClassifiedQuestion, QuestioningFinding } from "./questioning.js";

export interface QuestionFindingsGroup {
  question: ClassifiedQuestion;
  findings: QuestioningFinding[];
}

export interface WhatWhy {
  criterionId: string;
  what: string;
  why: string;
  /** 원래 발화에서 문제가 되는 부분을 그대로 인용한 문구 (일반론 금지, 코드가 실존 여부를 검증) */
  quotedOriginalText: string;
}

export interface SuggestionValidation {
  /** revisedQuestionLine을 문장형 기준(Q1·Q2·Q4·Q9)으로 재검증한 결과. 검증 대상이 아니면 null */
  reclassifiedOk: boolean | null;
  vocabOk: boolean;
  /** revisedQuestionLine이 원래 발문 문장과 똑같으면 실패 (검증 대상이 아니면 true) */
  notCopiedOk: boolean;
  /** Q1·Q2·Q4·Q9가 없는데 revisedQuestionLine이 채워져 있으면 실패 (코드가 null로 정정하지만, 정정이 있었다는 걸 기록) */
  questionLineScopeOk: boolean;
  /** Q6·Q7·Q8이 있는데 revisedResponseLine이 비어있으면 실패 */
  responseLineRequiredOk: boolean;
  /** revisedResponseLine이 "학생이 ~라고 답했구나"처럼 3인칭으로 쓰이면 실패 (직접 말을 거는 투여야 함) */
  responseLineFirstPersonOk: boolean;
  /** revisedResponseLine을 Q6/Q8 원자적 판정으로 재검증한 결과. 검증 대상이 아니면 null */
  responseLineRevisedOk: boolean | null;
  /** Q7이 있는데 revisedResponseLine에 정답이 들어있으면 실패 (검증 대상이 아니면 true) */
  noAnswerLeakOk: boolean;
  /** revisedQuestionLine에 다음 학생 발화의 핵심 결론(숫자·의미상 결론 모두)이 미리 들어있으면 실패 */
  noAnswerLeakInQuestionOk: boolean;
  /** whatAndWhy의 quotedOriginalText가 실제 발화에 있는지 (전부 있어야 true) */
  quotesGroundedOk: boolean;
  /** whatAndWhy의 각 항목이 다른 기준의 설명(특히 Q1의 "먼저~묻고" 순서 문구)을 섞어 쓰지 않았는지 */
  whatWhyIsolatedOk: boolean;
  /** Q3가 있는데 hintQuestionLine이 비어있으면 실패 */
  hintQuestionLineRequiredOk: boolean;
  /** Q3가 있는데 hintQuestionLine에 자문자답으로 이미 준 답이 들어있으면 실패 (검증 대상이 아니면 true) */
  noAnswerLeakInHintOk: boolean;
  /** Q3가 있는데 hintQuestionLine이 원래 발문의 재질문에 불과하면 실패 (LLM 원자적 판단, 검증 대상이 아니면 true) */
  hintNotRestatementOk: boolean;
  /** actions의 어떤 항목에도 대기시간(초) 관련 문구가 들어있으면 실패 (항상 코드가 담당해야 함) */
  actionScopeOk: boolean;
  /** Q8이 있는데 praisedStudentQuote가 실제 학생 발화에 없으면 실패 (검증 대상이 아니면 true) */
  praisedQuoteGroundedOk: boolean;
  /** Q3·Q5(코드 템플릿)를 뺀 대상 기준(병합 포함)이 whatAndWhy에 전부 있는지 — 하나라도 빠지면 실패 */
  whatWhyCoverageOk: boolean;
  /** Q6/Q8 재판정이 재생성 후에도 실패해서, 코드가 학생 발화를 그대로 인용한 되짚기 문장으로 revisedResponseLine을 대체했으면 true */
  usedCodeReplacementResponseLine: boolean;
  regenerated: boolean;
  /** 1회 재생성 후에도 실패하면 true (무한 재시도 방지, 결과는 그대로 제공) */
  stillFailingAfterRetry: boolean;
  notes: string[];
}

export interface Suggestion {
  questionIndex: number;
  originalQuestionText: string;
  criteriaAddressed: string[];
  /** Q1·Q2·Q4·Q9가 있을 때만 채워짐(코드가 강제). 그 외에는 항상 null */
  revisedQuestionLine: string | null;
  /** Q3만 있을 때, 학생 반응이 없으면 쓸 힌트 발문. Q1/2/4/9와 무관하게 별도로 존재 가능 */
  hintQuestionLine: string | null;
  /** Q6·Q7·Q8이 있을 때만 채워짐(있어야 함, 없으면 검증 실패) */
  revisedResponseLine: string | null;
  /**
   * 대사가 아닌 행동 지침. Q3·Q5의 대기시간 문구는 코드가 계산해서 직접 붙이고(LLM은
   * 이 부분을 쓰지 않음), 그 외 기준(예: Q9)에 필요한 행동 지침만 LLM이 보탠다.
   */
  suggestedAction: string | null;
  whatAndWhy: WhatWhy[];
  /** Q6/Q7/Q8 관련, 고쳐야 할 교사 반응 발화의 세그먼트 index들 */
  targetReactionSegmentIndices: number[];
  validation: SuggestionValidation;
  source: "ai";
}
