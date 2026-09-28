import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRITERIA_DIR = path.resolve(__dirname, "../../criteria");

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
