import type { QuestioningFinding } from "../../../src/types/questioning.js";
import type { Suggestion } from "../../../src/types/suggestion.js";
import { computeFindingId } from "../../../src/report/findingId.js";
import { HIGHLIGHT_GROUPS, groupForCriterion } from "../../lib/highlightConfig.js";
import { getSuggestionFieldVisibility } from "../../lib/suggestionFieldVisibility.js";

function FieldBlock({ label, value, ok }: { label: string; value: string | null; ok: boolean }) {
  if (!value) return null;
  if (!ok) {
    return (
      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-400">
        <span className="font-medium">{label}</span> — 검토 필요 (AI가 다시 확인이 필요해요)
      </div>
    );
  }
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
      <div className="mb-0.5 font-medium text-slate-500">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}

export function DetailPanel({
  selectedSegmentIndex,
  questioningFindings,
  suggestions,
  ignoredFindingIds,
  onToggleIgnore,
  onClose,
}: {
  selectedSegmentIndex: number;
  questioningFindings: QuestioningFinding[];
  suggestions: Suggestion[];
  ignoredFindingIds: Set<string>;
  onToggleIgnore: (id: string) => void;
  onClose: () => void;
}) {
  const findingsHere = questioningFindings.filter((f) =>
    f.segments.some((s) => s.index === selectedSegmentIndex)
  );

  const relatedQuestionIndices = Array.from(
    new Set(findingsHere.map((f) => f.targetQuestionIndex).filter((x): x is number => x !== null))
  );
  const relatedSuggestions = relatedQuestionIndices
    .map((qIdx) => suggestions.find((s) => s.questionIndex === qIdx))
    .filter((s): s is Suggestion => s !== undefined);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-lg lg:sticky lg:top-4 lg:inset-auto lg:max-h-[calc(100vh-2rem)] lg:w-96 lg:shrink-0 lg:rounded-lg lg:border lg:shadow-none">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">발화 [{selectedSegmentIndex}] 상세</h2>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100">
          닫기
        </button>
      </div>

      {findingsHere.length === 0 && <p className="text-sm text-slate-400">이 발화에 걸린 지적이 없습니다.</p>}

      <ul className="mb-4 space-y-2">
        {findingsHere.map((f) => {
          const id = computeFindingId(f);
          const isIgnored = ignoredFindingIds.has(id);
          const group = groupForCriterion(f.criterionId);
          return (
            <li key={id} className={`rounded-md border p-2.5 ${isIgnored ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200"}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    group ? HIGHLIGHT_GROUPS[group].badge : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {f.criterionName}
                </span>
                <span className="text-xs text-slate-400">{f.severity}</span>
              </div>
              <p className="text-sm text-slate-700">{f.reason}</p>
              <button
                type="button"
                onClick={() => onToggleIgnore(id)}
                className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                {isIgnored ? "무시 취소" : "이 지적 무시"}
              </button>
            </li>
          );
        })}
      </ul>

      {relatedSuggestions.map((s) => {
        const visibility = getSuggestionFieldVisibility(s.validation);
        return (
          <div key={s.questionIndex} className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-sm font-semibold text-slate-600">개선안 (발문 [{s.questionIndex}])</h3>
            <FieldBlock label="개선 발문" value={s.revisedQuestionLine} ok={visibility.questionLine} />
            <FieldBlock label="힌트 발문" value={s.hintQuestionLine} ok={visibility.hintLine} />
            <FieldBlock label="교사 반응 대사" value={s.revisedResponseLine} ok={visibility.responseLine} />
            <FieldBlock label="개선 행동" value={s.suggestedAction} ok={visibility.action} />
            {s.whatAndWhy.length > 0 && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <div className="mb-1 font-medium text-slate-500">왜 이렇게 고쳐야 할까요</div>
                <ul className="space-y-1">
                  {s.whatAndWhy.map((w, i) => (
                    <li key={i} className="text-slate-700">
                      {w.why}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
