import type { TranscriptSegment } from "./transcript.js";
import type { ClassificationSource } from "./common.js";

/** 관련 성취기준이 없을 때 보고서 제목 등에 쓰는 문구 */
export const UNMATCHED_LESSON_TITLE = "초등 수학 성취기준과 연결되지 않은 수업";

export interface ConceptMatch {
  /** false면 녹음 내용이 초등 수학과 관련이 없어 성취기준을 고르지 않았다 — 이때
   *  areaName·standardCode·standardSummary는 빈 문자열이고 3단계 용어 검사는 건너뛴다.
   *  이 필드가 생기기 전에 저장된 분석 결과에는 없으므로, undefined는 "연결됨"으로 본다. */
  matched?: boolean;
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
