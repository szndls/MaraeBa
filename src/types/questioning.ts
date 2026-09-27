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
  precedingQuestionSegment: TranscriptSegment | null;
  studentSegment: TranscriptSegment;
  responseWindowSegments: TranscriptSegment[];
}
