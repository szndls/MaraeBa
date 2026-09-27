import type { TranscriptSegment } from "./transcript.js";

export type VocabCategory = "certain_unknown" | "maybe_unknown" | "unlisted_hard_word";

export interface VocabFinding {
  term: string;
  category: VocabCategory;
  reason: string;
  /** 이 용어가 발견된 교사 발화 세그먼트 */
  foundInSegments: TranscriptSegment[];
  /** certain_unknown/maybe_unknown은 코드가 math-terms.json과 대조해서 결정(rule),
   *  unlisted_hard_word는 LLM이 판단(llm) */
  basis: "rule" | "llm";
}
