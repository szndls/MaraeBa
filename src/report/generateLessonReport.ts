import type { NormalizedTranscript } from "../types/transcript.js";
import type { ClassifiedQuestion, QuestioningFinding, ResponseEvent } from "../types/questioning.js";
import type { VocabFinding } from "../types/vocab.js";
import type { WaitTimeEvaluation } from "../questioning/checkWaitTime.js";
import type { ResponseProbingResult } from "../questioning/checkResponseHandling.js";
import type { LessonReport } from "../types/report.js";
import { computeL1, computeL2, computeL3, computeL4, computeL6, computeL7, computeGoodPoints } from "./computeLessonMetrics.js";
import { judgeL5, judgeL8 } from "./judgeLessonFlow.js";
import { generateLessonSummary } from "./generateLessonSummary.js";

export interface LessonReportInputs {
  transcript: NormalizedTranscript;
  questions: ClassifiedQuestion[];
  questioningFindings: QuestioningFinding[];
  vocabFindings: VocabFinding[];
  waitTimeEvaluations: WaitTimeEvaluation[];
  responseEvents: ResponseEvent[];
  probingResults: ResponseProbingResult[];
  /** 2단계에서 관련 성취기준을 찾았는지 — 못 찾으면 L7은 "검사 안 함"으로 표시 */
  conceptMatched: boolean;
}

/**
 * 무시 목록 없이 1~6단계 전체를 처음부터 계산한다(L5·L8을 포함해 LLM을 전부 부른다).
 * 이 결과를 output/analysis-<이름>.json에 통째로 저장해 두면, 이후 "지적 무시"
 * 재계산(recomputeReportFromAnalysis)은 이 파일만 읽어서 LLM 재호출 없이 끝난다.
 */
export async function generateLessonReport(inputs: LessonReportInputs): Promise<LessonReport> {
  const { transcript, questions, vocabFindings, waitTimeEvaluations, responseEvents, probingResults } = inputs;
  const { questioningFindings } = inputs;

  const l1 = computeL1(questions);
  const l2 = computeL2(waitTimeEvaluations);
  const l3 = computeL3(transcript, responseEvents);
  const l4 = computeL4(probingResults);
  const { metric: l6, priorityFixes } = computeL6(questioningFindings);
  const l7 = computeL7(vocabFindings, inputs.conceptMatched);
  const { metric: l5, warnings: l5Warnings } = await judgeL5(questions);
  const l8 = await judgeL8(transcript);

  const metrics = [l1, l2, l3, l4, l5, l6, l7, l8];
  const goodPoints = computeGoodPoints(questions, waitTimeEvaluations, probingResults, transcript, questioningFindings);

  const { summary, warnings: summaryWarnings } = await generateLessonSummary(metrics, goodPoints, priorityFixes);

  return {
    metrics,
    goodPoints,
    priorityFixes,
    overallSummary: summary,
    summaryWarnings: [...l5Warnings, ...summaryWarnings],
    ignoredFindingCount: 0,
    summaryStale: false,
  };
}
