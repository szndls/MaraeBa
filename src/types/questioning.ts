import type { TranscriptSegment } from "./transcript.js";

export interface QuestionCandidate {
  segment: TranscriptSegment;
  questionMarkCount: number;
}

export interface ClassifiedQuestion {
  segment: TranscriptSegment;
  questionType: string;
  questionMarkCount: number;
}

export interface QuestioningFinding {
  criterionId: string;
  criterionName: string;
  severity: string;
  segments: TranscriptSegment[];
  reason: string;
  detect: "code" | "llm" | "code+llm";
  /** 이 지적이 속하는 발문의 세그먼트 index (5단계에서 발문별로 지적을 묶는 데 사용).
   *  직전 교사 발화가 없는 드문 경우에만 null. */
  targetQuestionIndex: number | null;
  /** Q6/Q7/Q8 한정: 고쳐야 할 교사 반응 발화의 세그먼트 index (보통 응답 구간의 첫 발화). */
  targetReactionSegmentIndex?: number | null;
}

export interface ResponseEvent {
  /** 학생 답이 응답한 직전 교사 발화 */
  precedingQuestionSegment: TranscriptSegment | null;
  studentSegment: TranscriptSegment;
  /** 학생 답 직후부터 "다음 교사 발문 직전"까지의 교사 발화들 (판정 대상) */
  responseWindowSegments: TranscriptSegment[];
  /** 참고용 다음 발문 — 캐묻기인지 새 주제 질문인지는 LLM이 판단 */
  nextQuestionSegment: TranscriptSegment | null;
}
