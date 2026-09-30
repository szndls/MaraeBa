export type MetricGrade = "좋음" | "보통" | "개선 필요";

export interface MetricResult {
  id: string;
  name: string;
  /** L6처럼 등급을 매기지 않는 지표는 null (별도 표인 priorityFixes가 그 역할을 대신함) */
  grade: MetricGrade | null;
  /** 계산 과정을 사람이 읽을 수 있게 풀어 쓴 문장 (숫자·근거 포함) */
  detail: string;
  /** 기준 수치가 lesson-criteria.json에서 "임시값"으로 표시된 경우 true */
  isTemporaryCriteria: boolean;
  /** 이 판정의 근거가 된 발화 세그먼트 index (있으면) */
  evidenceSegmentIndices: number[];
}

export interface GoodPoint {
  text: string;
  segmentIndices: number[];
  /** 이 잘한 점이 어느 지표에서 뽑혔는지 (총평이 근거로 인용할 때 그 지표의 evidence로 검증) */
  relatedCriterionId: string;
}

export interface PriorityFix {
  criterionId: string;
  criterionName: string;
  /** 이 기준에서 나온 지적 중 가장 심각한 등급 (문제 > 개선 권장 > ...) */
  severity: string;
  count: number;
  exampleSegmentIndices: number[];
}

export interface LessonReport {
  metrics: MetricResult[];
  goodPoints: GoodPoint[];
  priorityFixes: PriorityFix[];
  overallSummary: string;
  /** 총평 생성 중 발견된 문제(예: 근거 없는 발화 인용) — 있으면 보고서에 함께 표시 */
  summaryWarnings: string[];
  /** 이번 계산에서 제외한 지적의 개수 (검산·재계산 확인용) */
  ignoredFindingCount: number;
}
