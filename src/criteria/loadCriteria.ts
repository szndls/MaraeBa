import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// 기준 파일 폴더는 "앱을 실행한 위치(프로젝트 맨 위)" 기준으로 찾는다.
// (예전처럼 이 파일 위치 기준으로 찾으면 Vercel에서는 빌드할 때의 경로가 박혀서 파일을 못 찾는다)
const CRITERIA_DIR = path.join(process.cwd(), "criteria");

/**
 * criteria/*.yaml 파일을 읽어서 텍스트 그대로 LLM 프롬프트에 넣을 수 있게 직렬화한다.
 * 이 앱의 criteria 파일들은 고정 스키마가 있는 것도 있고(코드 enum과 연결) 자유 서술형도 있는데,
 * 이 함수는 "자유 서술형" 파일용이다. 고정 스키마가 필요한 파일은 별도 로더에서 구조까지 검증한다.
 */
export function loadCriteriaAsPromptText(fileName: string): string {
  const filePath = path.join(CRITERIA_DIR, fileName);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(
      `criteria 파일을 읽을 수 없습니다: ${filePath}\ncriteria/ 폴더가 삭제되었거나 파일명이 바뀌지 않았는지 확인하세요.`
    );
  }

  const parsed = yaml.load(raw);
  return yaml.dump(parsed, { lineWidth: -1 });
}

export function loadConceptGuessGuidelinesText(): string {
  return loadCriteriaAsPromptText("concept-guess-guidelines.yaml");
}

export function loadVocabDetectionNotesText(): string {
  return loadCriteriaAsPromptText("vocab-detection-notes.yaml");
}
