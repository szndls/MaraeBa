import type { ReactNode } from "react";
import type { TranscriptSegment } from "../../../src/types/transcript.js";
import type { SegmentHighlight } from "../../lib/computeHighlights.js";
import { HIGHLIGHT_GROUPS, type HighlightGroupKey } from "../../lib/highlightConfig.js";
import { formatTimestamp } from "../../lib/format.js";
import { WaitTimeChip } from "./WaitTimeChip.js";

function renderHighlightedText(text: string, vocabSpans: SegmentHighlight["vocabSpans"]) {
  if (vocabSpans.length === 0) return text;

  type Range = { start: number; end: number };
  const ranges: Range[] = [];
  for (const span of vocabSpans) {
    const start = text.indexOf(span.term);
    if (start === -1) continue;
    ranges.push({ start, end: start + span.term.length });
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a.start - b.start);

  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue; // 겹치면 먼저 찾은 것만 칠함
    if (r.start > cursor) pieces.push(text.slice(cursor, r.start));
    pieces.push(
      <mark key={r.start} className="rounded bg-purple-200 px-0.5 text-purple-900">
        {text.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
}

export function TranscriptLine({
  segment,
  highlight,
  waitTimeSeconds,
  isSelected,
  isGroupVisible,
  onSelect,
}: {
  segment: TranscriptSegment;
  highlight: SegmentHighlight | undefined;
  waitTimeSeconds: number | null;
  isSelected: boolean;
  isGroupVisible: (group: HighlightGroupKey) => boolean;
  onSelect: (index: number) => void;
}) {
  const paintGroup = highlight?.group && isGroupVisible(highlight.group) ? highlight.group : null;
  const paintCfg = paintGroup ? HIGHLIGHT_GROUPS[paintGroup] : null;
  const isStrong = highlight?.severity === "문제";
  const bgClass = paintCfg ? (isStrong ? paintCfg.strong : paintCfg.light) : "";

  const visibleBadges = (highlight?.badges ?? []).filter((b) => isGroupVisible(b.group));
  const clickable = visibleBadges.length > 0;
  const showWaitChip = highlight?.waitChip && isGroupVisible("wait");

  return (
    <div id={`segment-${segment.index}`}>
      <div
        className={`flex gap-3 rounded-md px-2 py-1.5 ${
          segment.speaker === "teacher" ? "" : "opacity-80"
        } ${isSelected ? "ring-2 ring-slate-400" : ""} ${clickable ? "cursor-pointer hover:brightness-95" : ""}`}
        onClick={clickable ? () => onSelect(segment.index) : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
      >
        <span className="w-10 shrink-0 pt-0.5 text-xs text-slate-400">{formatTimestamp(segment.start)}</span>
        <span
          className={`w-14 shrink-0 pt-0.5 text-xs font-medium ${
            segment.speaker === "teacher" ? "text-slate-600" : "text-slate-400"
          }`}
        >
          {segment.speaker === "teacher" ? "선생님" : "학생"}
        </span>
        <div className="flex-1">
          <span className={bgClass ? `${bgClass} rounded px-1 py-0.5` : undefined}>
            {renderHighlightedText(segment.text, highlight?.vocabSpans ?? [])}
          </span>
          {visibleBadges.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {visibleBadges.map((b, i) => (
                <span
                  key={`${b.criterionId}-${i}`}
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${HIGHLIGHT_GROUPS[b.group].badge}`}
                >
                  {b.criterionName}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      {showWaitChip && highlight?.waitChip && (
        <WaitTimeChip seconds={waitTimeSeconds} severity={highlight.waitChip.severity} />
      )}
    </div>
  );
}
