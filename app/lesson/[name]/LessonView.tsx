"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalysisResult } from "../../../src/types/analysis.js";
import type { LessonReport } from "../../../src/types/report.js";
import { computeFindingId } from "../../../src/report/findingId.js";
import { computeSegmentHighlights } from "../../lib/computeHighlights.js";
import { HIGHLIGHT_GROUPS, type HighlightGroupKey } from "../../lib/highlightConfig.js";
import { loadIgnoredIds, saveIgnoredIds } from "../../lib/localIgnoreStore.js";
import { Legend } from "./Legend.js";
import { TranscriptPane } from "./TranscriptPane.js";
import { DetailPanel } from "./DetailPanel.js";
import { ReportSection } from "./ReportSection.js";

const ALL_FILTERS_ON = Object.fromEntries(
  Object.keys(HIGHLIGHT_GROUPS).map((k) => [k, true])
) as Record<HighlightGroupKey, boolean>;

export function LessonView({
  name,
  analysis,
  severityOrder,
}: {
  name: string;
  analysis: AnalysisResult;
  severityOrder: string[];
}) {
  const [ignoredFindingIds, setIgnoredFindingIds] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<LessonReport>(analysis.report);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<Record<HighlightGroupKey, boolean>>(ALL_FILTERS_ON);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);

  async function fetchReport(ids: string[], regenerateSummary: boolean) {
    if (regenerateSummary) setIsRegeneratingSummary(true);
    else setIsRecomputing(true);
    try {
      const res = await fetch(`/api/lessons/${name}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoredFindingIds: ids, regenerateSummary }),
      });
      if (res.ok) {
        const next = (await res.json()) as LessonReport;
        setReport(next);
      }
    } finally {
      if (regenerateSummary) setIsRegeneratingSummary(false);
      else setIsRecomputing(false);
    }
  }

  useEffect(() => {
    const stored = loadIgnoredIds(name);
    if (stored.length > 0) {
      setIgnoredFindingIds(new Set(stored));
      fetchReport(stored, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  function toggleIgnore(id: string) {
    const next = new Set(ignoredFindingIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIgnoredFindingIds(next);
    const asArray = Array.from(next);
    saveIgnoredIds(name, asArray);
    fetchReport(asArray, false);
  }

  function toggleFilter(group: HighlightGroupKey) {
    setActiveFilters((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  function jumpToSegment(index: number) {
    setSelectedSegmentIndex(index);
    requestAnimationFrame(() => {
      document.getElementById(`segment-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const filteredFindings = useMemo(
    () => analysis.questioningFindings.filter((f) => !ignoredFindingIds.has(computeFindingId(f))),
    [analysis.questioningFindings, ignoredFindingIds]
  );

  const highlights = useMemo(
    () =>
      computeSegmentHighlights(
        analysis.transcript,
        filteredFindings,
        analysis.vocabFindings,
        analysis.waitTimeEvaluations,
        severityOrder
      ),
    [analysis.transcript, filteredFindings, analysis.vocabFindings, analysis.waitTimeEvaluations, severityOrder]
  );

  return (
    <div className="mx-auto max-w-6xl p-4 lg:flex lg:items-start lg:gap-4">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-800">
            {analysis.conceptMatch.grade}학년 · {analysis.conceptMatch.standardCode}{" "}
            {analysis.conceptMatch.standardSummary}
          </h1>
          {isRecomputing && <span className="text-xs text-slate-400">재계산 중...</span>}
        </div>
        <Legend activeFilters={activeFilters} onToggle={toggleFilter} />
        <TranscriptPane
          transcript={analysis.transcript}
          highlights={highlights}
          waitTimeEvaluations={analysis.waitTimeEvaluations}
          selectedSegmentIndex={selectedSegmentIndex}
          activeFilters={activeFilters}
          onSelectSegment={jumpToSegment}
        />
        <ReportSection
          report={report}
          onJumpToSegment={jumpToSegment}
          onRegenerateSummary={() => fetchReport(Array.from(ignoredFindingIds), true)}
          isRegeneratingSummary={isRegeneratingSummary}
        />
      </div>

      {selectedSegmentIndex !== null && (
        <DetailPanel
          selectedSegmentIndex={selectedSegmentIndex}
          questioningFindings={analysis.questioningFindings}
          suggestions={analysis.suggestions}
          ignoredFindingIds={ignoredFindingIds}
          onToggleIgnore={toggleIgnore}
          onClose={() => setSelectedSegmentIndex(null)}
        />
      )}
    </div>
  );
}
