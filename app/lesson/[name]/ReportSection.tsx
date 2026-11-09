import type { LessonReport } from "../../../src/types/report.js";

const GRADE_STYLE: Record<string, string> = {
  좋음: "bg-emerald-100 text-emerald-800",
  보통: "bg-amber-100 text-amber-800",
  "개선 필요": "bg-rose-100 text-rose-800",
};

function SegmentRefs({ indices, onJump }: { indices: number[]; onJump: (index: number) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {indices.map((idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => onJump(idx)}
          className="rounded-md border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] text-stone-500 hover:border-chalk hover:text-chalk"
        >
          [{idx}]
        </button>
      ))}
    </span>
  );
}

export function ReportSection({
  report,
  onJumpToSegment,
  onRegenerateSummary,
  isRegeneratingSummary,
}: {
  report: LessonReport;
  onJumpToSegment: (index: number) => void;
  onRegenerateSummary: () => void;
  isRegeneratingSummary: boolean;
}) {
  return (
    <section className="card space-y-6 p-5">
      <div>
        <h2 className="text-lg font-bold">수업 전체 리포트</h2>
        <p className="text-xs text-stone-400">점수 대신 지표별 상태와 근거 발화를 보여 줘요. [번호]를 누르면 해당 발화로 이동해요.</p>
      </div>

      {/* 지표 카드: 지표 이름, 등급, 설명 */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {report.metrics.map((m) => (
          <div key={m.id} className="rounded-xl border border-line p-3.5">
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">
                {m.name}
                {m.isTemporaryCriteria && (
                  <span className="ml-1.5 rounded bg-stone-100 px-1 py-0.5 align-middle text-[10px] font-normal text-stone-400">임시 기준</span>
                )}
              </span>
              {m.grade && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${GRADE_STYLE[m.grade] ?? ""}`}>
                  {m.grade}
                </span>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-stone-500">{m.detail}</p>
          </div>
        ))}
      </div>

      {report.goodPoints.length > 0 && (
        <div className="rounded-xl bg-emerald-50/70 p-4">
          <h3 className="mb-2 text-sm font-bold text-emerald-800">👍 잘한 점</h3>
          <ul className="space-y-1.5 text-sm leading-relaxed text-stone-700">
            {report.goodPoints.map((g, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-emerald-500">•</span>
                <span>
                  {g.text}{" "}
                  <SegmentRefs indices={g.segmentIndices} onJump={onJumpToSegment} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.priorityFixes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-bold">🎯 먼저 고칠 점</h3>
          <ol className="space-y-2">
            {report.priorityFixes.map((p, i) => (
              <li key={p.criterionId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line px-3.5 py-2.5 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-chalk text-xs font-bold text-white">{i + 1}</span>
                <span className="font-semibold">{p.criterionName}</span>
                <span className={`text-xs font-semibold ${p.severity === "문제" ? "text-rose-600" : "text-amber-600"}`}>{p.severity}</span>
                <span className="text-xs text-stone-400">{p.count}건</span>
                <span className="ml-auto">
                  <SegmentRefs indices={p.exampleSegmentIndices} onJump={onJumpToSegment} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-bold">📝 총평</h3>
        {report.summaryStale && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>⚠️ 총평이 최신이 아니에요 (무시 목록이 반영되지 않았어요)</span>
            <button
              type="button"
              onClick={onRegenerateSummary}
              disabled={isRegeneratingSummary}
              className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {isRegeneratingSummary ? "다시 만드는 중..." : "총평 다시 만들기"}
            </button>
          </div>
        )}
        <p className="rounded-xl bg-stone-50 p-4 text-sm leading-7 text-stone-700">{report.overallSummary}</p>
        {report.summaryWarnings.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs text-stone-400">
            {report.summaryWarnings.map((w, i) => (
              <li key={i}>⚠️ {w}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
