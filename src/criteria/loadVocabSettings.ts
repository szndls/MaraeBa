import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRITERIA_DIR = path.resolve(__dirname, "../../criteria");

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
