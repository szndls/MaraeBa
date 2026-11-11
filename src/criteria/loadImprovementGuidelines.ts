import { readFileSync } from "node:fs";
import path from "node:path";

// 기준 파일 폴더는 "앱을 실행한 위치(프로젝트 맨 위)" 기준으로 찾는다.
// (예전처럼 이 파일 위치 기준으로 찾으면 Vercel에서는 빌드할 때의 경로가 박혀서 파일을 못 찾는다)
const CRITERIA_DIR = path.join(process.cwd(), "criteria");

export interface ImprovementGuidelines {
  title: string;
  status: string;
  tone: string;
  length: Record<string, string>;
  what_to_avoid: string[];
  per_criterion_guidance: Record<string, string>;
  validation: {
    max_retry: number;
    recheck_all_sentence_criteria: string[];
    note: string;
  };
}

let cached: ImprovementGuidelines | null = null;

export function loadImprovementGuidelines(): ImprovementGuidelines {
  if (cached) return cached;
  const filePath = path.join(CRITERIA_DIR, "improvement-guidelines.json");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`criteria/improvement-guidelines.json을 읽을 수 없습니다: ${filePath}`);
  }
  cached = JSON.parse(raw) as ImprovementGuidelines;
  return cached;
}
