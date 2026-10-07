import { HIGHLIGHT_GROUPS } from "../../lib/highlightConfig.js";
import { formatSeconds } from "../../lib/format.js";

export function WaitTimeChip({ seconds, severity }: { seconds: number | null; severity: string }) {
  const cfg = HIGHLIGHT_GROUPS.wait;
  const strong = severity === "문제";
  const colorClass = strong ? cfg.strong : cfg.light;
  return (
    <div className="my-1 ml-2 flex sm:ml-14">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-sky-900 ${colorClass}`}
      >
        ⏱ {seconds === null ? "대기시간 계산 불가" : `${formatSeconds(seconds)}초`}
      </span>
    </div>
  );
}
