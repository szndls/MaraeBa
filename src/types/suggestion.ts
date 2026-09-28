import type { ClassifiedQuestion, QuestioningFinding } from "./questioning.js";

export interface QuestionFindingsGroup {
  question: ClassifiedQuestion;
  findings: QuestioningFinding[];
}

export interface WhatWhy {
  criterionId: string;
  what: string;
  why: string;
}

export interface SuggestionValidation {
  /** revisedQuestionText가 없으면 null (검증 대상 아님) */
  reclassifiedOk: boolean | null;
  vocabOk: boolean;
  regenerated: boolean;
  /** 1회 재생성 후에도 실패하면 true (무한 재시도 방지, 결과는 그대로 제공) */
  stillFailingAfterRetry: boolean;
  notes: string[];
}

export interface Suggestion {
  questionIndex: number;
  originalQuestionText: string;
  criteriaAddressed: string[];
  /** 문장형 기준(Q1·Q2·Q4·Q9)이 있을 때만 채워짐 */
  revisedQuestionText: string | null;
  /** 행동형 기준(Q3·Q5·Q6·Q7·Q8)이 있을 때만 채워짐 */
  suggestedAction: string | null;
  exampleTeacherLine: string | null;
  whatAndWhy: WhatWhy[];
  expectedStudentResponse: string;
  /** Q6/Q7/Q8 관련, 고쳐야 할 교사 반응 발화의 세그먼트 index들 */
  targetReactionSegmentIndices: number[];
  validation: SuggestionValidation;
  source: "ai";
}
