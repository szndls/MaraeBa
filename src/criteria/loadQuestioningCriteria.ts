import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRITERIA_DIR = path.resolve(__dirname, "../../criteria");

export interface QuestioningCriterion {
  id: string;
  name: string;
  description: string;
  detect: "code" | "llm" | "code+llm";
  hint_for_code?: string;
  judge_rule?: string;
  severity?: string;
  thresholds?: Record<string, string>;
  exception?: string;
  note?: string;
  verified?: boolean;
  basis?: string;
}

export interface QuestioningCriteriaFile {
  title: string;
  status: string;
  question_type_scheme: {
    name: string;
    types: Record<string, string>;
    note: string;
  };
  definitions: {
    wait_time_1: string;
    wait_time_2: string;
    severity: Record<string, string>;
  };
  criteria: QuestioningCriterion[];
  excluded: Array<{ name: string; reason: string }>;
}

let cached: QuestioningCriteriaFile | null = null;

export function loadQuestioningCriteria(): QuestioningCriteriaFile {
  if (cached) return cached;
  const filePath = path.join(CRITERIA_DIR, "questioning-criteria.json");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`criteria/questioning-criteria.json을 읽을 수 없습니다: ${filePath}`);
  }
  cached = JSON.parse(raw) as QuestioningCriteriaFile;
  return cached;
}

export function getCriterion(id: string): QuestioningCriterion {
  const file = loadQuestioningCriteria();
  const criterion = file.criteria.find((c) => c.id === id);
  if (!criterion) {
    throw new Error(`criteria/questioning-criteria.json에서 기준 ${id}를 찾을 수 없습니다.`);
  }
  return criterion;
}

export function getQuestionTypes(): string[] {
  return Object.keys(loadQuestioningCriteria().question_type_scheme.types);
}

/**
 * definitions.severity에 나열된 순서를 심각도 우선순위로 본다 (먼저 나올수록 더 심각).
 * 거기 없는(예: Q5의 "고차원 발문 추가 권장") 커스텀 라벨은 정의된 심각도보다 낮게 취급한다.
 * (questioning-criteria.json 자체에는 우선순위가 숫자로 적혀있지 않아서, 파일 구조에서
 * 합리적으로 추론한 규칙 — 사용자가 다르게 정하면 이 함수만 바꾸면 된다)
 */
export function severityRank(label: string): number {
  const order = Object.keys(loadQuestioningCriteria().definitions.severity);
  const idx = order.indexOf(label);
  return idx === -1 ? -1 : order.length - idx;
}
