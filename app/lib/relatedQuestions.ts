import type { QuestioningFinding } from "../../src/types/questioning.js";
import { computeFindingId } from "../../src/report/findingId.js";

/** 고른 발화에 걸린(무시되지 않은) 지적들이 가리키는 발문 번호들 — 이 발문들의 개선안을 보여 준다. */
export function relatedQuestionIndices(
  findings: QuestioningFinding[],
  segmentIndex: number,
  ignoredFindingIds: Set<string>
): number[] {
  const active = findings.filter(
    (f) => f.segments.some((s) => s.index === segmentIndex) && !ignoredFindingIds.has(computeFindingId(f))
  );
  return Array.from(new Set(active.map((f) => f.targetQuestionIndex).filter((x): x is number => x !== null)));
}
