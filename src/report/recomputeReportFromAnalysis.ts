import type { AnalysisResult } from "../types/analysis.js";
import type { LessonReport, MetricResult } from "../types/report.js";
import { computeL1, computeL2, computeL3, computeL4, computeL6, computeL7, computeGoodPoints } from "./computeLessonMetrics.js";
import { computeFindingId } from "./findingId.js";

function findMetric(metrics: MetricResult[], id: string): MetricResult {
  const found = metrics.find((m) => m.id === id);
  if (!found) throw new Error(`캐시된 분석 결과에 지표 ${id}가 없습니다.`);
  return found;
}

/**
 * output/analysis-<이름>.json(무시 목록 없이 한 번 계산해 둔 전체 분석)을 읽어서,
 * ignoredFindingIds를 적용한 리포트를 코드로만 재계산한다 — LLM을 다시 부르지
 * 않는다. L1·L2·L3·L4·L6·L7·잘한 점은 코드로 다시 계산하고(questioningFindings만
 * 영향을 받고 나머지는 원래도 questioningFindings와 무관해서 결과가 같다),
 * L5·L8은 캐시된 값을 그대로 재사용한다(질문 목록·전사본 자체는 안 바뀌므로
 * 다시 판정할 필요가 없다).
 *
 * 총평은 다시 만들지 않는다(LLM 재호출 없음이 원칙) — priorityFixes나 L6 내용이
 * 무시 목록 때문에 실제로 달라졌으면 summaryStale=true로 표시해서, 총평이 무시
 * 적용 전 지표를 근거로 쓴 것일 수 있다는 걸 알린다.
 */
export function recomputeReportFromAnalysis(
  analysis: AnalysisResult,
  ignoredFindingIds: Set<string> = new Set()
): LessonReport {
  const { transcript, questions, vocabFindings, waitTimeEvaluations, responseEvents, probingResults } = analysis;

  const filteredFindings = analysis.questioningFindings.filter(
    (f) => !ignoredFindingIds.has(computeFindingId(f))
  );

  const l1 = computeL1(questions);
  const l2 = computeL2(waitTimeEvaluations);
  const l3 = computeL3(transcript, responseEvents);
  const l4 = computeL4(probingResults);
  const { metric: l6, priorityFixes } = computeL6(filteredFindings);
  const l7 = computeL7(vocabFindings, analysis.conceptMatch.matched !== false);
  const l5 = findMetric(analysis.report.metrics, "L5");
  const l8 = findMetric(analysis.report.metrics, "L8");

  const metrics = [l1, l2, l3, l4, l5, l6, l7, l8];
  const goodPoints = computeGoodPoints(questions, waitTimeEvaluations, probingResults, transcript, filteredFindings);

  const baselineL6 = findMetric(analysis.report.metrics, "L6");
  const metricsChanged =
    l6.detail !== baselineL6.detail ||
    JSON.stringify(priorityFixes) !== JSON.stringify(analysis.report.priorityFixes);

  return {
    metrics,
    goodPoints,
    priorityFixes,
    overallSummary: analysis.report.overallSummary,
    summaryWarnings: analysis.report.summaryWarnings,
    ignoredFindingCount: ignoredFindingIds.size,
    summaryStale: ignoredFindingIds.size > 0 && metricsChanged,
  };
}
