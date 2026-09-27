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
