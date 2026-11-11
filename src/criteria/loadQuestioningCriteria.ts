import { readFileSync } from "node:fs";
import path from "node:path";

// 기준 파일 폴더는 "앱을 실행한 위치(프로젝트 맨 위)" 기준으로 찾는다.
// (예전처럼 이 파일 위치 기준으로 찾으면 Vercel에서는 빌드할 때의 경로가 박혀서 파일을 못 찾는다)
const CRITERIA_DIR = path.join(process.cwd(), "criteria");

export interface QuestioningCriterion {
  id: string;
  name: string;
  description: string;
  detect: "code" | "llm" | "code+llm";
  /** 이 기준이 턴/문장/세그먼트 중 어느 단위로 판단하는지 — reconstruction 설정 참고 */
  analysis_unit?: "turn" | "sentence" | "segment";
  hint_for_code?: string;
  judge_rule?: string;
  severity?: string;
  /** Q5 전용: 조건(condition)마다 심각도(severity, "문제"/"개선 권장"만)와 판정 문구를
   *  명시적으로 분리한다 — 조건 이름 자체를 severity로 쓰지 않는다. */
  thresholds?: Array<{ condition: string; severity: string; description: string }>;
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
  reconstruction?: {
    turn_merge_gap_sec: number;
    note?: string;
    units?: Record<string, string>;
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

/** 같은 화자가 이 간격(초) 이하로 이어지면 한 턴으로 묶는다 — src/questioning/reconstructUtterances.ts */
export function getTurnMergeGapSec(): number {
  const value = loadQuestioningCriteria().reconstruction?.turn_merge_gap_sec;
  if (typeof value !== "number") {
    throw new Error("criteria/questioning-criteria.json에 reconstruction.turn_merge_gap_sec이 없습니다.");
  }
  return value;
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
