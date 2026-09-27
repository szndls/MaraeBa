import type { TranscriptSegment } from "./transcript.js";
import type { ClassificationSource } from "./common.js";

export interface ConceptMatch {
  grade: number;
  band: string;
  areaName: string;
  standardCode: string;
  standardSummary: string;
  rationale: string;
  /** 추측 근거가 된 교사 발화 세그먼트 */
  evidenceSegments: TranscriptSegment[];
  source: ClassificationSource;
}
