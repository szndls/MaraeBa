import type { NormalizedTranscript } from "../../../src/types/transcript.js";
import type { WaitTimeEvaluation } from "../../../src/questioning/checkWaitTime.js";
import type { SegmentHighlight } from "../../lib/computeHighlights.js";
import type { HighlightGroupKey } from "../../lib/highlightConfig.js";
import { TranscriptLine } from "./TranscriptLine.js";

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
    <div className="rounded-lg border border-slate-200 bg-white p-3">
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
  );
}
