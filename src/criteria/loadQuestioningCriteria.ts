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
  representative_phrases?: {
    note: string;
    phrases: string[];
  };
}

export interface QuestioningCriteriaFile {
  title: string;
  status: string;
  stabilization?: {
    classification_repeats: number;
    note?: string;
  };
  question_type_scheme: {
    name: string;
    types: Record<string, string>;
    note: string;
    judging_principle?: string;
    contrast_examples?: Array<{
      shared_ending: string;
      cases: Array<{ text: string; type: string; why: string }>;
    }>;
  };
  question_candidate_endings: {
    note: string;
    endings: string[];
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

/**
 * 1이면 끔(기존과 동일). 3처럼 홀수로 켜면 발문 분류를 그 횟수만큼 반복해서 다수결로
 * 정한다. CLASSIFICATION_REPEATS 환경변수가 있으면 criteria 파일 값보다 우선한다
 * (안정성 비교 실험처럼 파일을 고치지 않고 임시로 켜고 끌 때 편의용).
 */
export function getClassificationRepeats(): number {
  const envOverride = process.env.CLASSIFICATION_REPEATS;
  if (envOverride) return Number(envOverride);
  return loadQuestioningCriteria().stabilization?.classification_repeats ?? 1;
}

export function getQuestionTypes(): string[] {
  return Object.keys(loadQuestioningCriteria().question_type_scheme.types);
}

export function getQuestionCandidateEndings(): string[] {
  return loadQuestioningCriteria().question_candidate_endings.endings;
}

/** 후보를 넓게 잡는 힌트로만 쓰는 대표 표현 목록. 없으면 빈 배열(힌트 없이 LLM이 전부 판단). */
export function getRepresentativePhrases(id: string): string[] {
  return getCriterion(id).representative_phrases?.phrases ?? [];
}

/**
 * definitions.severity에 나열된 순서를 심각도 우선순위로 본다 (먼저 나올수록 더 심각).
 * 거기 없는(예: Q5의 "고차원 발문 대기 부족") 커스텀 라벨은 정의된 심각도보다 낮게 취급한다.
 * (questioning-criteria.json 자체에는 우선순위가 숫자로 적혀있지 않아서, 파일 구조에서
 * 합리적으로 추론한 규칙 — 사용자가 다르게 정하면 이 함수만 바꾸면 된다)
 */
export function severityRank(label: string): number {
  const order = Object.keys(loadQuestioningCriteria().definitions.severity);
  const idx = order.indexOf(label);
  return idx === -1 ? -1 : order.length - idx;
}
