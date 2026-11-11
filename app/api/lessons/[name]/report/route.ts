import { NextResponse } from "next/server";
import type { AnalysisResult } from "../../../../../src/types/analysis.js";
import { recomputeReportFromAnalysis } from "../../../../../src/report/recomputeReportFromAnalysis.js";
import { generateLessonSummary } from "../../../../../src/report/generateLessonSummary.js";

interface RequestBody {
  analysis?: AnalysisResult;
  ignoredFindingIds?: string[];
  regenerateSummary?: boolean;
}

/**
 * 무시 목록을 적용해 리포트를 재계산한다(LLM 호출 없음). 서버에 분석 결과를 저장해
 * 두지 않으므로(브라우저 IndexedDB에만 있음), 매번 요청 본문에 전체 분석 결과를
 * 함께 받는다. body.regenerateSummary가 true일 때만 generateLessonSummary를 불러
 * 총평을 다시 만든다 — 이 라우트에서 LLM을 부르는 건 그 경우 하나뿐이다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RequestBody;
  if (!body.analysis) {
    return NextResponse.json({ error: "분석 결과가 없습니다." }, { status: 400 });
  }

  const ignoredFindingIds = new Set(body.ignoredFindingIds ?? []);

  let report = recomputeReportFromAnalysis(body.analysis, ignoredFindingIds);

  if (body.regenerateSummary) {
    const { summary, warnings } = await generateLessonSummary(report.metrics, report.goodPoints, report.priorityFixes);
    report = { ...report, overallSummary: summary, summaryWarnings: warnings, summaryStale: false };
  }

  return NextResponse.json(report);
}
