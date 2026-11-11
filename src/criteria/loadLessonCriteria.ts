import { readFileSync } from "node:fs";
import path from "node:path";

// 기준 파일 폴더는 "앱을 실행한 위치(프로젝트 맨 위)" 기준으로 찾는다.
// (예전처럼 이 파일 위치 기준으로 찾으면 Vercel에서는 빌드할 때의 경로가 박혀서 파일을 못 찾는다)
const CRITERIA_DIR = path.join(process.cwd(), "criteria");

export interface LessonMetricDefinition {
  id: string;
  name: string;
  description: string;
  detect: string;
  /** 좋음/보통/개선 필요를 가르는 문장. 값은 문자열(자유 서술) 또는 등급별 문자열 맵. */
  rule: string | Record<string, string>;
  reference_range?: Record<string, string>;
  verified?: boolean;
  note?: string;
}

export interface LessonCriteriaFile {
  title: string;
  status: string;
  levels: string[];
  metrics: LessonMetricDefinition[];
  report: {
    total_score: string;
    reason: string;
  };
}

let cached: LessonCriteriaFile | null = null;

export function loadLessonCriteria(): LessonCriteriaFile {
  if (cached) return cached;
  const filePath = path.join(CRITERIA_DIR, "lesson-criteria.json");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`criteria/lesson-criteria.json을 읽을 수 없습니다: ${filePath}`);
  }
  cached = JSON.parse(raw) as LessonCriteriaFile;
  return cached;
}

export function getLessonMetric(id: string): LessonMetricDefinition {
  const file = loadLessonCriteria();
  const metric = file.metrics.find((m) => m.id === id);
  if (!metric) {
    throw new Error(`criteria/lesson-criteria.json에서 지표 ${id}를 찾을 수 없습니다.`);
  }
  return metric;
}

/** "3초 이상인 비율 ≥ 70%"처럼 문구에 있는 첫 번째 %숫자를 그대로 읽는다. */
export function extractPercent(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

/**
 * rule이 {좋음, 보통, 개선 필요} 형태로 등급별 문구를 담고 있을 때, 그 문구들에 나온
 * %숫자를 전부 모아 오름차순으로 정리한다. lesson-criteria.json의 L2·L3·L4처럼
 * "낮은 경계값, 높은 경계값" 두 개가 나오는 구조를 코드가 하드코딩하지 않고 그대로
 * 읽기 위한 함수 — 숫자 자체는 항상 이 파일에서만 읽는다.
 */
export function extractAscendingPercentThresholds(rule: Record<string, string>): number[] {
  const all = Object.values(rule)
    .map((text) => extractPercent(text))
    .filter((n): n is number => n !== null);
  return Array.from(new Set(all)).sort((a, b) => a - b);
}

/** verified===false 이거나 note에 "임시값"이 언급되면 이 지표는 임시 기준으로 표시한다. */
export function isTemporaryCriteria(metric: LessonMetricDefinition): boolean {
  if (metric.verified === false) return true;
  if (metric.note && metric.note.includes("임시값")) return true;
  return false;
}
