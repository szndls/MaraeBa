import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  AreaName,
  MathGradeBand,
  MathTermsFile,
  StandardCatalogEntry,
} from "../types/mathTerms.js";

// 기준 파일 폴더는 "앱을 실행한 위치(프로젝트 맨 위)" 기준으로 찾는다.
// (예전처럼 이 파일 위치 기준으로 찾으면 Vercel에서는 빌드할 때의 경로가 박혀서 파일을 못 찾는다)
const CRITERIA_DIR = path.join(process.cwd(), "criteria");

let cached: MathTermsFile | null = null;

export function loadMathTerms(): MathTermsFile {
  if (cached) return cached;

  const filePath = path.join(CRITERIA_DIR, "math-terms.json");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`criteria/math-terms.json을 읽을 수 없습니다: ${filePath}`);
  }

  cached = JSON.parse(raw) as MathTermsFile;
  return cached;
}

/** 교사가 입력한 학년(1~6)에 해당하는 학년군을 찾는다 */
export function getGradeBandForGrade(grade: number): MathGradeBand {
  const file = loadMathTerms();
  const band = file.grade_bands.find((b) => b.grades.includes(grade));
  if (!band) {
    throw new Error(
      `학년 ${grade}에 해당하는 학년군을 criteria/math-terms.json에서 찾을 수 없습니다.`
    );
  }
  return band;
}

/** 해당 학년군의 모든 영역·성취기준을 평탄화한 목록 (LLM 프롬프트/enum 구성용) */
export function buildStandardsCatalog(band: MathGradeBand): StandardCatalogEntry[] {
  const catalog: StandardCatalogEntry[] = [];
  for (const [areaName, area] of Object.entries(band.areas) as [AreaName, typeof band.areas[AreaName]][]) {
    for (const standard of area.standards) {
      catalog.push({ code: standard.code, areaName, summary: standard.summary });
    }
  }
  return catalog;
}

/** grade_bands 배열에서의 순번 (파일에 학년 낮은 순으로 정렬되어 있다고 가정) */
export function getBandOrderIndex(bandLabel: string): number {
  const file = loadMathTerms();
  const idx = file.grade_bands.findIndex((b) => b.band === bandLabel);
  if (idx === -1) throw new Error(`알 수 없는 학년군: ${bandLabel}`);
  return idx;
}

export interface TermOccurrence {
  band: string;
  areaName: AreaName;
  /** 이 용어가 딸린 성취기준. 영역 전체 목록에만 있고 특정 성취기준에 안 딸린 경우 undefined */
  standardCode?: string;
}

/**
 * 순수 문장부호/기호(+, −, ×, ÷, <, >, ., :, %, ° 등)는 구어 전사 텍스트에서
 * 오탐(false positive) 가능성이 높아 용어 대조 대상에서 제외한다.
 */
function isSymbolOnly(term: string): boolean {
  return /^[+\-−×÷<>.:%°=]+$/.test(term);
}

/**
 * 1글자 용어("면", "비", "구", "각", "변", "도" 등)는 단순 부분 문자열 대조에서
 * "비교", "~하면", "친구" 같은 무관한 단어 안에 끼어 오탐될 위험이 매우 높다.
 * 형태소 분석 없이는 정확히 구분할 수 없으므로, 이번 버전에서는 대조 대상에서 제외한다.
 * (알려진 한계 — 나중에 형태소 분석기를 붙이면 개선 가능)
 */
function isTooShortToMatchSafely(term: string): boolean {
  return Array.from(term).length <= 1;
}

/**
 * 모든 학년군 + 중학교 후보 용어를 하나의 인덱스로 만든다.
 * 같은 용어가 여러 곳에 나오는 경우는 이 데이터셋에는 없다고 가정하고 첫 항목만 쓴다.
 */
export function buildTermIndex(): Map<string, TermOccurrence[]> {
  const file = loadMathTerms();
  const index = new Map<string, TermOccurrence[]>();

  const add = (term: string, occurrence: TermOccurrence) => {
    if (isSymbolOnly(term) || isTooShortToMatchSafely(term)) return;
    const list = index.get(term) ?? [];
    list.push(occurrence);
    index.set(term, list);
  };

  for (const band of file.grade_bands) {
    for (const [areaName, area] of Object.entries(band.areas) as [AreaName, typeof band.areas[AreaName]][]) {
      // 성취기준에 직접 딸린 용어부터 태깅 (순서 판단에 필요)
      const tagged = new Set<string>();
      for (const standard of area.standards) {
        for (const term of standard.terms ?? []) {
          add(term, { band: band.band, areaName, standardCode: standard.code });
          tagged.add(term);
        }
      }
      // 영역 전체 목록 중 특정 성취기준에 안 딸린 나머지는 standardCode 없이 등록
      for (const term of area.terms) {
        if (!tagged.has(term)) {
          add(term, { band: band.band, areaName });
        }
      }
    }
  }

  for (const term of file.middle_school_candidates.terms) {
    add(term, { band: "middle_school", areaName: "수와 연산" }); // areaName은 중학교 용어에선 의미 없음
  }

  return index;
}
