/** criteria/math-terms.json 구조에 대응하는 타입 */

export interface MathStandard {
  code: string;
  summary: string;
  /** 이 성취기준에 직접 딸린 용어 (모든 성취기준에 있는 건 아님) */
  terms?: string[];
}

export interface MathArea {
  verified: boolean;
  /** 이 영역에서 등장하는 용어 전체 목록 (성취기준 단위로 안 나뉜 것도 포함) */
  terms: string[];
  term_notes?: string;
  standards: MathStandard[];
}

export type AreaName = "수와 연산" | "변화와 관계" | "도형과 측정" | "자료와 가능성";

export interface MathGradeBand {
  band: string;
  grades: number[];
  areas: Record<AreaName, MathArea>;
}

export interface MathTermsFile {
  title: string;
  source: string;
  how_to_use: {
    certain_unknown: string;
    maybe_unknown: string;
    note_on_order: string;
    non_curriculum_words: string;
  };
  grade_bands: MathGradeBand[];
  middle_school_candidates: {
    verified: boolean;
    note: string;
    terms: string[];
  };
}

/** 프롬프트/enum 구성에 쓰는 평탄화된 성취기준 목록 */
export interface StandardCatalogEntry {
  code: string;
  areaName: AreaName;
  summary: string;
}
