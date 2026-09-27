/** AI가 판단했는지, 교사가 수정했는지 구분 (설계 원칙: AI의 판단 결과는 교사가 수정할 수 있어야 함) */
export type ClassificationSource = "ai" | "teacher_edited";
