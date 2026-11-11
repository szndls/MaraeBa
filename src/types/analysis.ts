import type { NormalizedTranscript } from "./transcript.js";
import type { ConceptMatch } from "./concept.js";
import type { VocabFinding } from "./vocab.js";
import type { ClassifiedQuestion, QuestioningFinding, ResponseEvent } from "./questioning.js";
import type { Suggestion } from "./suggestion.js";
import type { LessonReport } from "./report.js";
import type { WaitTimeEvaluation } from "../questioning/checkWaitTime.js";
import type { ResponseProbingResult } from "../questioning/checkResponseHandling.js";
import type { ImprovementStats } from "../suggestions/generateImprovements.js";

/**
 * 1~6단계 전체 분석 결과를 통째로 담아 output/analysis-<이름>.json으로 저장한다.
 * "무시 목록 적용" 재계산이 LLM을 다시 부르지 않고 이 파일만 읽어서 끝나게 하기
 * 위한 캐시다 — waitTimeEvaluations·responseEvents·probingResults처럼 6단계
 * 코드 계산에 필요한 중간 데이터까지 전부 포함한다.
 */
export interface AnalysisResult {
  sourceFile: string;
  runAt: string;
  transcript: NormalizedTranscript;
  conceptMatch: ConceptMatch;
  vocabFindings: VocabFinding[];
  questions: ClassifiedQuestion[];
  questioningFindings: QuestioningFinding[];
  waitTimeEvaluations: WaitTimeEvaluation[];
  responseEvents: ResponseEvent[];
  probingResults: ResponseProbingResult[];
  suggestions: Suggestion[];
  suggestionStats: ImprovementStats;
  /** true면 분석 때 개선안을 만들지 않았다 — 보고서에서 발화를 누를 때 /api/suggestion으로
   *  그 발문 것만 만들어 suggestions에 채워 넣는다. 없거나 false면 미리 다 만들어져 있다. */
  suggestionsDeferred?: boolean;
  /** 무시 목록 없이 처음 계산한 기준 리포트 — L5·L8처럼 LLM이 만든 결과는 여기서 그대로 재사용된다. */
  report: LessonReport;
}
