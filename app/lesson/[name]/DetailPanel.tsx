import type { QuestioningFinding } from "../../../src/types/questioning.js";
import type { Suggestion } from "../../../src/types/suggestion.js";
import { computeFindingId } from "../../../src/report/findingId.js";
import { HIGHLIGHT_GROUPS, groupForCriterion } from "../../lib/highlightConfig.js";
import { getSuggestionFieldVisibility } from "../../lib/suggestionFieldVisibility.js";
import { relatedQuestionIndices as findRelatedQuestionIndices } from "../../lib/relatedQuestions.js";

// "개선 발문/힌트/개선 행동"은 발문 쪼갠에 속하고, "교사 반응 대사"는 반응 발화 쪽에
// 속한다 — 반응 발화([2] 등)를 눌렀을 때 그 발문의 대기시간 행동까지 같이 뜨는 걸
// 막기 위해, 클릭한 발화에 실제로 걸린(무시되지 않은) 기준으로만 보여줄 필드를 가른다.
const QUESTION_MOMENT_CRITERIA = [...HIGHLIGHT_GROUPS.question.criteria, ...HIGHLIGHT_GROUPS.wait.criteria];
const REACTION_MOMENT_CRITERIA = HIGHLIGHT_GROUPS.reaction.criteria;

function FieldBlock({ label, value, ok }: { label: string; value: string | null; ok: boolean }) {
  if (!value) return null;
  if (!ok) {
    return (
      <div className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-400">
        <span className="font-medium">{label}</span> — 검토 필요 (AI가 다시 확인이 필요해요)
      </div>
    );
  }
  return (
    <div className="rounded-xl border-l-4 border-chalk bg-chalk-soft/60 px-3.5 py-2.5 text-sm">
      <div className="mb-1 text-xs font-semibold text-chalk">{label}</div>
      <div className="leading-relaxed text-ink">{value}</div>
    </div>
  );
}

export function DetailPanel({
  selectedSegmentIndex,
  questioningFindings,
  suggestions,
  pendingSuggestionIndices,
  failedSuggestionIndices,
  onRetrySuggestion,
  ignoredFindingIds,
  onToggleIgnore,
  onClose,
}: {
  selectedSegmentIndex: number;
  questioningFindings: QuestioningFinding[];
  suggestions: Suggestion[];
  /** 지금 만들고 있는 개선안의 발문 번호 */
  pendingSuggestionIndices: Set<number>;
  /** 만들다 실패한 개선안의 발문 번호 */
  failedSuggestionIndices: Set<number>;
  onRetrySuggestion: (questionIndex: number) => void;
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

  const relatedQuestionIndices = findRelatedQuestionIndices(questioningFindings, selectedSegmentIndex, ignoredFindingIds);
  const relatedSuggestions = relatedQuestionIndices
    .map((qIdx) => suggestions.find((s) => s.questionIndex === qIdx))
    .filter((s): s is Suggestion => s !== undefined);
  const pendingHere = relatedQuestionIndices.filter((q) => pendingSuggestionIndices.has(q));
  const failedHere = relatedQuestionIndices.filter((q) => failedSuggestionIndices.has(q));

  const showQuestionFields = QUESTION_MOMENT_CRITERIA.some((id) => activeCriteriaHere.has(id));
  const showReactionFields = REACTION_MOMENT_CRITERIA.some((id) => activeCriteriaHere.has(id));

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-y-auto rounded-t-3xl border-t border-line bg-white p-5 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] lg:sticky lg:top-20 lg:inset-auto lg:max-h-[calc(100vh-6rem)] lg:w-96 lg:shrink-0 lg:rounded-2xl lg:border lg:shadow-sm">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200 lg:hidden" />
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold">발화 [{selectedSegmentIndex}] 자세히 보기</h2>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-stone-400 hover:bg-stone-100" aria-label="닫기">
          ✕
        </button>
      </div>

      {findingsHere.length === 0 && <p className="text-sm text-stone-400">이 발화에 걸린 지적이 없습니다.</p>}

      <ul className="mb-4 space-y-2">
        {findingsHere.map((f) => {
          const id = computeFindingId(f);
          const isIgnored = ignoredFindingIds.has(id);
          const group = groupForCriterion(f.criterionId);
          return (
            <li key={id} className={`rounded-xl border p-3.5 ${isIgnored ? "border-line bg-stone-50 opacity-60" : "border-line bg-white"}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    group ? HIGHLIGHT_GROUPS[group].badge : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {f.criterionName}
                </span>
                <span className={`text-xs font-semibold ${f.severity === "문제" ? "text-rose-600" : "text-amber-600"}`}>{f.severity}</span>
              </div>
              {isIgnored ? (
                <p className="text-sm italic text-stone-400">무시한 지적이에요.</p>
              ) : (
                <p className="text-sm leading-relaxed text-stone-700">{f.reason}</p>
              )}
              <button
                type="button"
                onClick={() => onToggleIgnore(id)}
                className="mt-2.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100"
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
          <div key={s.questionIndex} className="space-y-2 border-t border-line pt-4">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-chalk">✏️ 이렇게 바꿔 보세요 <span className="font-normal text-stone-400">발문 [{s.questionIndex}]</span></h3>
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

      {pendingHere.map((q) => (
        <div key={`pending-${q}`} className="space-y-2 border-t border-line pt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-chalk">✏️ 이렇게 바꿔 보세요 <span className="font-normal text-stone-400">발문 [{q}]</span></h3>
          <div className="flex items-center gap-2 rounded-xl bg-stone-50 px-3.5 py-3 text-sm text-stone-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-chalk-soft border-t-chalk" />
            개선안 만드는 중…
          </div>
        </div>
      ))}

      {failedHere.map((q) => (
        <div key={`failed-${q}`} className="space-y-2 border-t border-line pt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-chalk">✏️ 이렇게 바꿔 보세요 <span className="font-normal text-stone-400">발문 [{q}]</span></h3>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-stone-50 px-3.5 py-3 text-sm text-stone-500">
            개선안을 만들지 못했어요.
            <button type="button" onClick={() => onRetrySuggestion(q)} className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100">
              다시 시도
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
