import { HIGHLIGHT_GROUPS, type HighlightGroupKey } from "../../lib/highlightConfig.js";

// 형광펜 색 범례 겸 필터. 누르면 그 색의 형광펜을 켜고 끈다. 옆 숫자는 지적 개수.
export function Legend({
  activeFilters,
  onToggle,
  counts,
}: {
  activeFilters: Record<HighlightGroupKey, boolean>;
  onToggle: (group: HighlightGroupKey) => void;
  counts: Record<HighlightGroupKey, number>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
      {(Object.entries(HIGHLIGHT_GROUPS) as Array<[HighlightGroupKey, (typeof HIGHLIGHT_GROUPS)[HighlightGroupKey]]>).map(
        ([key, cfg]) => {
          const on = activeFilters[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={on}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                on ? "border-line bg-white hover:border-stone-300" : "border-dashed border-line bg-stone-50 opacity-50"
              }`}
            >
              <span className={`h-8 w-1.5 shrink-0 rounded-full ${cfg.strong}`} />
              <span className="min-w-0">
                <span className="block text-lg font-bold leading-none">{counts[key]}</span>
                <span className="block truncate text-xs text-stone-500">{cfg.label}</span>
              </span>
            </button>
          );
        }
      )}
    </div>
  );
}
