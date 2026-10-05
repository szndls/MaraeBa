import { HIGHLIGHT_GROUPS, type HighlightGroupKey } from "../../lib/highlightConfig.js";

export function Legend({
  activeFilters,
  onToggle,
}: {
  activeFilters: Record<HighlightGroupKey, boolean>;
  onToggle: (group: HighlightGroupKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium text-slate-600">범례</span>
      {(Object.entries(HIGHLIGHT_GROUPS) as Array<[HighlightGroupKey, (typeof HIGHLIGHT_GROUPS)[HighlightGroupKey]]>).map(
        ([key, cfg]) => (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
              activeFilters[key] ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50 opacity-50"
            }`}
          >
            <span className={`h-3 w-3 rounded-full ${cfg.strong}`} />
            {cfg.label}
          </button>
        )
      )}
    </div>
  );
}
