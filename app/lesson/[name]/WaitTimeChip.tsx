import { HIGHLIGHT_GROUPS } from "../../lib/highlightConfig.js";
import { formatSeconds } from "../../lib/format.js";

// 발문과 다음 발화 사이에 "⏱ 0.6초"처럼 기다린 시간을 보여 주는 작은 표시
export function WaitTimeChip({ seconds, severity }: { seconds: number | null; severity: string }) {
  const cfg = HIGHLIGHT_GROUPS.wait;
  const strong = severity === "문제";
  const colorClass = strong ? cfg.strong : cfg.light;
  return (
    <div className="flex items-center gap-2 py-1 pl-3 sm:pl-[6.5rem]">
      <span className="h-px w-4 bg-sky-200" />
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-sky-900 ${colorClass}`}>
        ⏱ {seconds === null ? "대기 시간 계산 불가" : `${formatSeconds(seconds)}초 기다림`}
      </span>
    </div>
  );
}
