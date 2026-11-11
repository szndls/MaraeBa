/** 심각도 표시 순서 — questioning-criteria.json을 빌드 시점에 그대로 불러온다
 *  (node:fs를 쓰는 src/criteria/loadQuestioningCriteria.ts는 브라우저에서 못 쓴다). */
import questioningCriteria from "../../criteria/questioning-criteria.json";

export const severityOrder: string[] = Object.keys(questioningCriteria.definitions.severity);
