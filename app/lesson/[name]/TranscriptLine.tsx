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
      <mark key={r.start} className="rounded bg-purple-200 px-0.5 text-purple-900 underline decoration-purple-400 decoration-2 underline-offset-2">
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

  const isTeacher = segment.speaker === "teacher";

  return (
    <div id={`segment-${segment.index}`}>
      <div
        className={`group flex flex-col gap-1 rounded-xl px-3 py-2.5 transition sm:flex-row sm:items-start sm:gap-3 ${
          isSelected ? "bg-chalk-soft ring-2 ring-chalk/40" : ""
        } ${clickable ? "cursor-pointer hover:bg-stone-50" : ""}`}
        onClick={clickable ? () => onSelect(segment.index) : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
      >
        {/* 모바일: 시각·화자를 한 줄로 묶어 문장 위에 올린다. sm 이상: sm:contents로
            래퍼를 없애서 두 칸이 다시 가로로 놓인다. */}
        <div className="flex items-center gap-2 sm:contents">
          <span className="font-mono text-[11px] tabular-nums text-stone-400 sm:w-9 sm:shrink-0 sm:pt-1">
            {formatTimestamp(segment.start)}
          </span>
          <span
            className={`inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold sm:w-14 sm:shrink-0 sm:justify-center ${
              isTeacher ? "bg-chalk text-white" : "bg-stone-100 text-stone-500"
            }`}
          >
            {isTeacher ? "선생님" : "학생"}
          </span>
        </div>
        <div className={`flex-1 text-[15px] leading-7 ${isTeacher ? "text-ink" : "text-stone-500"}`}>
          <span className={bgClass ? `${bgClass} box-decoration-clone rounded-md px-1 py-0.5` : undefined}>
            {renderHighlightedText(segment.text, highlight?.vocabSpans ?? [])}
          </span>
          {visibleBadges.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {visibleBadges.map((b, i) => (
                <span
                  key={`${b.criterionId}-${i}`}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${HIGHLIGHT_GROUPS[b.group].badge}`}
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
