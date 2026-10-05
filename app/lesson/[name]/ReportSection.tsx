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
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
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
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-700">수업 전체 평가</h2>

      <table className="w-full text-sm">
        <tbody>
          {report.metrics.map((m) => (
            <tr key={m.id} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-3 align-top font-medium text-slate-600">
                {m.name}
                {m.isTemporaryCriteria && (
                  <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-400">임시 기준</span>
                )}
              </td>
              <td className="w-20 py-2 pr-3 align-top">
                {m.grade && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${GRADE_STYLE[m.grade] ?? ""}`}>
                    {m.grade}
                  </span>
                )}
              </td>
              <td className="py-2 align-top text-slate-600">{m.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.goodPoints.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-600">잘한 점</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {report.goodPoints.map((g, i) => (
              <li key={i} className="flex items-start gap-2">
                <span>•</span>
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
          <h3 className="mb-1.5 text-sm font-semibold text-slate-600">먼저 고칠 점</h3>
          <table className="w-full text-sm">
            <tbody>
              {report.priorityFixes.map((p) => (
                <tr key={p.criterionId} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3 font-medium text-slate-700">{p.criterionName}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{p.severity}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{p.count}건</td>
                  <td className="py-1.5">
                    <SegmentRefs indices={p.exampleSegmentIndices} onJump={onJumpToSegment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-slate-600">총평</h3>
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
        <p className="text-sm text-slate-700">{report.overallSummary}</p>
        {report.summaryWarnings.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {report.summaryWarnings.map((w, i) => (
              <li key={i}>⚠️ {w}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
