import type { NormalizedTranscript } from "../types/transcript.js";
import type { ClassifiedQuestion, QuestioningFinding, ResponseEvent } from "../types/questioning.js";
import type { VocabFinding } from "../types/vocab.js";
import type { WaitTimeEvaluation } from "../questioning/checkWaitTime.js";
import type { ResponseProbingResult } from "../questioning/checkResponseHandling.js";
import type { LessonReport } from "../types/report.js";
import { computeL1, computeL2, computeL3, computeL4, computeL6, computeL7, computeGoodPoints } from "./computeLessonMetrics.js";
import { judgeL5, judgeL8 } from "./judgeLessonFlow.js";
import { generateLessonSummary } from "./generateLessonSummary.js";
import { computeFindingId } from "./findingId.js";

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
 * ignoredFindingIds는 "기준:발문번호:반응발화번호"(computeFindingId) 형태의 고정 id다.
 * 배열 위치가 아니라 그 지적이 가리키는 실제 발화를 기준으로 만들어서, 같은
 * 전사본을 다시 실행해도(재생성으로 순서가 바뀌어도) 같은 지적이면 같은 id가 나온다
 * — UI가 "이 지적 무시" 상태를 저장했다가 다음 실행에도 그대로 적용할 수 있다.
 */
export async function generateLessonReport(
  inputs: LessonReportInputs,
  ignoredFindingIds: Set<string> = new Set()
): Promise<LessonReport> {
  const { transcript, questions, vocabFindings, waitTimeEvaluations, responseEvents, probingResults } = inputs;

  const questioningFindings = inputs.questioningFindings.filter((f) => !ignoredFindingIds.has(computeFindingId(f)));

  const l1 = computeL1(questions);
  const l2 = computeL2(waitTimeEvaluations);
  const l3 = computeL3(transcript, responseEvents);
  const l4 = computeL4(probingResults);
  const { metric: l6, priorityFixes } = computeL6(questioningFindings);
  const l7 = computeL7(vocabFindings);
  const { metric: l5, warnings: l5Warnings } = await judgeL5(questions);
  const l8 = await judgeL8(transcript);

  const metrics = [l1, l2, l3, l4, l5, l6, l7, l8];
  const goodPoints = computeGoodPoints(questions, waitTimeEvaluations, probingResults, transcript);

  const { summary, warnings: summaryWarnings } = await generateLessonSummary(metrics, goodPoints, priorityFixes);

  return {
    metrics,
    goodPoints,
    priorityFixes,
    overallSummary: summary,
    summaryWarnings: [...l5Warnings, ...summaryWarnings],
    ignoredFindingCount: ignoredFindingIds.size,
  };
}
