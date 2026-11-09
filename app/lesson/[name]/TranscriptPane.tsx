import type { NormalizedTranscript } from "../../../src/types/transcript.js";
import type { WaitTimeEvaluation } from "../../../src/questioning/checkWaitTime.js";
import type { SegmentHighlight } from "../../lib/computeHighlights.js";
import type { HighlightGroupKey } from "../../lib/highlightConfig.js";
import { TranscriptLine } from "./TranscriptLine.js";

// 수업 기록(받아쓴 발화 목록) 카드
export function TranscriptPane({
  transcript,
  highlights,
  waitTimeEvaluations,
  selectedSegmentIndex,
  activeFilters,
  onSelectSegment,
}: {
  transcript: NormalizedTranscript;
  highlights: Map<number, SegmentHighlight>;
  waitTimeEvaluations: WaitTimeEvaluation[];
  selectedSegmentIndex: number | null;
  activeFilters: Record<HighlightGroupKey, boolean>;
  onSelectSegment: (index: number) => void;
}) {
  const waitByQuestionIndex = new Map(
    waitTimeEvaluations.map((e) => [e.question.segment.index, e.waitTimeSec] as const)
  );
  const isGroupVisible = (group: HighlightGroupKey) => activeFilters[group];

  return (
    <section className="card">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3.5">
        <h2 className="font-bold">수업 기록</h2>
        <span className="text-xs text-stone-400">진하게 = 문제 · 연하게 = 개선 권장</span>
      </div>
      <div className="px-2 py-2 sm:px-3">
        {transcript.segments.map((segment) => (
          <TranscriptLine
            key={segment.index}
            segment={segment}
            highlight={highlights.get(segment.index)}
            waitTimeSeconds={waitByQuestionIndex.get(segment.index) ?? null}
            isSelected={selectedSegmentIndex === segment.index}
            isGroupVisible={isGroupVisible}
            onSelect={onSelectSegment}
          />
        ))}
      </div>
    </section>
  );
}
