import { readFileSync } from "node:fs";
import path from "node:path";

// 기준 파일 폴더는 "앱을 실행한 위치(프로젝트 맨 위)" 기준으로 찾는다.
// (예전처럼 이 파일 위치 기준으로 찾으면 Vercel에서는 빌드할 때의 경로가 박혀서 파일을 못 찾는다)
const CRITERIA_DIR = path.join(process.cwd(), "criteria");

interface VocabSettingsFile {
  enable_unlisted_hard_word: boolean;
}

let cached: VocabSettingsFile | null = null;

function loadVocabSettings(): VocabSettingsFile {
  if (cached) return cached;

  const filePath = path.join(CRITERIA_DIR, "vocab-settings.json");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`criteria/vocab-settings.json을 읽을 수 없습니다: ${filePath}`);
  }

  cached = JSON.parse(raw) as VocabSettingsFile;
  return cached;
}

/** 목록에 없는 어려운 어휘를 LLM이 찾는 기능(unlisted_hard_word)을 켤지 여부. */
export function isUnlistedHardWordDetectionEnabled(): boolean {
  return loadVocabSettings().enable_unlisted_hard_word === true;
}
