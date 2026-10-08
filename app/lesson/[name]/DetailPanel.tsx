import type { QuestioningFinding } from "../../../src/types/questioning.js";
import type { Suggestion } from "../../../src/types/suggestion.js";
import { computeFindingId } from "../../../src/report/findingId.js";
import { HIGHLIGHT_GROUPS, groupForCriterion } from "../../lib/highlightConfig.js";
import { getSuggestionFieldVisibility } from "../../lib/suggestionFieldVisibility.js";

// "개선 발문/힌트/개선 행동"은 발문 쪼갠에 속하고, "교사 반응 대사"는 반응 발화 쪽에
// 속한다 — 반응 발화([2] 등)를 눌렀을 때 그 발문의 대기시간 행동까지 같이 뜨는 걸
// 막기 위해, 클릭한 발화에 실제로 걸린(무시되지 않은) 기준으로만 보여줄 필드를 가른다.
const QUESTION_MOMENT_CRITERIA = [...HIGHLIGHT_GROUPS.question.criteria, ...HIGHLIGHT_GROUPS.wait.criteria];
const REACTION_MOMENT_CRITERIA = HIGHLIGHT_GROUPS.reaction.criteria;

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
  // 무시한 지적은 아래 개선안 섹션(이유·개선 행동)에서는 완전히 빠진다 — 위쪽
  // 목록에만 "무시 취소"를 위해 흐리게 남는다.
  const activeFindingsHere = findingsHere.filter((f) => !ignoredFindingIds.has(computeFindingId(f)));
  const activeCriteriaHere = new Set(activeFindingsHere.map((f) => f.criterionId));

  const relatedQuestionIndices = Array.from(
    new Set(activeFindingsHere.map((f) => f.targetQuestionIndex).filter((x): x is number => x !== null))
  );
  const relatedSuggestions = relatedQuestionIndices
    .map((qIdx) => suggestions.find((s) => s.questionIndex === qIdx))
    .filter((s): s is Suggestion => s !== undefined);

  const showQuestionFields = QUESTION_MOMENT_CRITERIA.some((id) => activeCriteriaHere.has(id));
  const showReactionFields = REACTION_MOMENT_CRITERIA.some((id) => activeCriteriaHere.has(id));

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
              {isIgnored ? (
                <p className="text-sm italic text-slate-400">무시한 지적이에요.</p>
              ) : (
                <p className="text-sm text-slate-700">{f.reason}</p>
              )}
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
        // whatAndWhy(왜 이렇게 고쳐야 할까요)는 위쪽 지적 이유와 내용이 겹치는
        // 일반론이라 패널에서는 숨긴다 — 데이터(Suggestion.whatAndWhy)는 그대로
        // 남아 있고, 분석 결과 JSON에도 계속 저장된다.
        const visibility = getSuggestionFieldVisibility(s.validation);
        return (
          <div key={s.questionIndex} className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-sm font-semibold text-slate-600">개선안 (발문 [{s.questionIndex}])</h3>
            {showQuestionFields && (
              <>
                <FieldBlock label="개선 발문" value={s.revisedQuestionLine} ok={visibility.questionLine} />
                <FieldBlock label="힌트 발문" value={s.hintQuestionLine} ok={visibility.hintLine} />
                <FieldBlock label="개선 행동" value={s.suggestedAction} ok={visibility.action} />
              </>
            )}
            {showReactionFields && (
              <FieldBlock label="교사 반응 대사" value={s.revisedResponseLine} ok={visibility.responseLine} />
            )}
          </div>
        );
      })}
    </div>
  );
}
