"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AnalysisResult } from "../../../src/types/analysis.js";
import type { LessonReport } from "../../../src/types/report.js";
import { computeFindingId } from "../../../src/report/findingId.js";
import { computeSegmentHighlights } from "../../lib/computeHighlights.js";
import { HIGHLIGHT_GROUPS, groupForCriterion, type HighlightGroupKey } from "../../lib/highlightConfig.js";
import { loadIgnoredIds, saveIgnoredIds } from "../../lib/localIgnoreStore.js";
import { addSavedName } from "../../lib/savedNames.client.js";
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
  initiallySaved,
}: {
  name: string;
  analysis: AnalysisResult;
  severityOrder: string[];
  initiallySaved: boolean;
}) {
  // 저장하기: 누르면 기록 목록에 들어간다
  const [isSaved, setIsSaved] = useState(initiallySaved);
  const [isSaving, setIsSaving] = useState(false);
  function save() {
    setIsSaving(true);
    try {
      addSavedName(name);
      setIsSaved(true);
    } finally {
      setIsSaving(false);
    }
  }
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
        body: JSON.stringify({ analysis, ignoredFindingIds: ids, regenerateSummary }),
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

  // 범례 옆에 보여 줄 묶음별 지적 개수 (무시한 지적은 빼고 센다)
  const groupCounts = useMemo(() => {
    const counts: Record<HighlightGroupKey, number> = { question: 0, wait: 0, reaction: 0, vocab: 0 };
    for (const f of filteredFindings) {
      const g = groupForCriterion(f.criterionId);
      if (g) counts[g] += 1;
    }
    counts.vocab = analysis.vocabFindings.length;
    return counts;
  }, [filteredFindings, analysis.vocabFindings]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 lg:flex lg:items-start lg:gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        {/* 저장하기 · 홈으로 */}
        <div className="flex items-center justify-end gap-2">
          <Link href="/" className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50">
            홈으로
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={isSaved || isSaving}
            className="rounded-xl bg-chalk px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {isSaved ? "✓ 저장됨" : isSaving ? "저장하는 중…" : "저장하기"}
          </button>
        </div>
        {/* 수업 제목 카드 */}
        <section className="card overflow-hidden">
          <div className="bg-chalk px-5 py-5 text-white">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-white/70">
              <span>{analysis.conceptMatch.grade}학년 수학</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5">{analysis.conceptMatch.standardCode}</span>
              {isRecomputing && <span className="ml-auto animate-pulse">다시 계산하는 중…</span>}
            </div>
            <h1 className="text-xl font-bold leading-snug sm:text-2xl">{analysis.conceptMatch.standardSummary}</h1>
          </div>
          <Legend activeFilters={activeFilters} onToggle={toggleFilter} counts={groupCounts} />
        </section>

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

      {selectedSegmentIndex !== null ? (
        <DetailPanel
          selectedSegmentIndex={selectedSegmentIndex}
          questioningFindings={analysis.questioningFindings}
          suggestions={analysis.suggestions}
          ignoredFindingIds={ignoredFindingIds}
          onToggleIgnore={toggleIgnore}
          onClose={() => setSelectedSegmentIndex(null)}
        />
      ) : (
        // 아무 발화도 고르지 않았을 때 넓은 화면 오른쪽에 보이는 안내
        <aside className="card sticky top-20 hidden w-96 shrink-0 p-6 text-center lg:block">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-chalk-soft text-xl">👆</div>
          <p className="font-semibold">형광펜이 칠해진 발화를 눌러 보세요</p>
          <p className="mt-1 text-sm leading-relaxed text-stone-500">왜 지적되었는지와 바로 쓸 수 있는 개선 발문이 여기에 나타나요.</p>
        </aside>
      )}
    </main>
  );
}
