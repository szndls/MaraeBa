/**
 * 형광펜 색·묶음 설정. 색이나 묶음을 바꾸고 싶으면 이 파일만 고치면 된다 —
 * 컴포넌트는 그룹 키("question"/"wait"/"reaction"/"vocab")와 strong/light만 참조한다.
 */
export type HighlightGroupKey = "question" | "wait" | "reaction" | "vocab";

export interface HighlightGroupConfig {
  label: string;
  /** 이 묶음에 속하는 4단계 기준 id (vocab은 criteria 밖의 3단계 용어라 비워둠) */
  criteria: string[];
  /** 심각도 "문제" 등 — 진하게 */
  strong: string;
  /** 심각도 "개선 권장" 등 — 연하게 */
  light: string;
  /** 배지(기준 이름 pill) 색 */
  badge: string;
}

export const HIGHLIGHT_GROUPS: Record<HighlightGroupKey, HighlightGroupConfig> = {
  question: {
    label: "발문 자체",
    criteria: ["Q1", "Q2", "Q4", "Q9"],
    strong: "bg-yellow-300",
    light: "bg-yellow-100",
    badge: "bg-yellow-200 text-yellow-900",
  },
  wait: {
    label: "기다림",
    criteria: ["Q3", "Q5"],
    strong: "bg-sky-300",
    light: "bg-sky-100",
    badge: "bg-sky-200 text-sky-900",
  },
  reaction: {
    label: "학생 답 이후 반응",
    criteria: ["Q6", "Q7", "Q8"],
    strong: "bg-pink-300",
    light: "bg-pink-100",
    badge: "bg-pink-200 text-pink-900",
  },
  vocab: {
    label: "어려운 용어",
    criteria: [],
    strong: "bg-purple-300",
    light: "bg-purple-100",
    badge: "bg-purple-200 text-purple-900",
  },
};

/** 기준 id로 소속 묶음 키를 찾는다. Q3·Q5처럼 하나의 묶음에 여러 기준이 있을 수 있다. */
export function groupForCriterion(criterionId: string): HighlightGroupKey | null {
  for (const [key, cfg] of Object.entries(HIGHLIGHT_GROUPS) as Array<
    [HighlightGroupKey, HighlightGroupConfig]
  >) {
    if (cfg.criteria.includes(criterionId)) return key;
  }
  return null;
}
