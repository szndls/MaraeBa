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
}

/**
 * ignoredFindingIds는 questioningFindings 배열의 index다(같은 배열을 넘길 때만
 * 의미가 있는, 이 호출 한정의 위치 기반 id). "이 지적을 빼고 다시 계산해 줘"를
 * 지원하기 위한 것으로, 영속적인 id가 아니다.
 */
export async function generateLessonReport(
  inputs: LessonReportInputs,
  ignoredFindingIds: Set<number> = new Set()
): Promise<LessonReport> {
  const { transcript, questions, vocabFindings, waitTimeEvaluations, responseEvents, probingResults } = inputs;

  const questioningFindings = inputs.questioningFindings.filter((_, i) => !ignoredFindingIds.has(i));

  const l1 = computeL1(questions);
  const l2 = computeL2(waitTimeEvaluations);
  const l3 = computeL3(transcript, responseEvents);
  const l4 = computeL4(probingResults);
  const { metric: l6, priorityFixes } = computeL6(questioningFindings);
  const l7 = computeL7(vocabFindings);
  const l5 = await judgeL5(questions);
  const l8 = await judgeL8(transcript);

  const metrics = [l1, l2, l3, l4, l5, l6, l7, l8];
  const goodPoints = computeGoodPoints(questions, waitTimeEvaluations, probingResults, transcript);

  const { summary, warnings } = await generateLessonSummary(metrics, goodPoints, priorityFixes);

  return {
    metrics,
    goodPoints,
    priorityFixes,
    overallSummary: summary,
    summaryWarnings: warnings,
    ignoredFindingCount: ignoredFindingIds.size,
  };
}
