import { NextResponse } from "next/server";
import { readAnalysis } from "../../../../lib/analysisStore.server.js";
import { recomputeReportFromAnalysis } from "../../../../../src/report/recomputeReportFromAnalysis.js";
import { generateLessonSummary } from "../../../../../src/report/generateLessonSummary.js";

interface RequestBody {
  ignoredFindingIds?: string[];
  regenerateSummary?: boolean;
}

/**
 * 무시 목록을 적용해 리포트를 재계산한다(LLM 호출 없음). body.regenerateSummary가
 * true일 때만 generateLessonSummary를 불러 총평을 다시 만든다 — 이 라우트에서
 * LLM을 부르는 건 그 경우 하나뿐이다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const analysis = await readAnalysis(name);
  if (!analysis) {
    return NextResponse.json({ error: `분석 결과를 찾을 수 없습니다: ${name}` }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const ignoredFindingIds = new Set(body.ignoredFindingIds ?? []);

  let report = recomputeReportFromAnalysis(analysis, ignoredFindingIds);

  if (body.regenerateSummary) {
    const { summary, warnings } = await generateLessonSummary(report.metrics, report.goodPoints, report.priorityFixes);
    report = { ...report, overallSummary: summary, summaryWarnings: warnings, summaryStale: false };
  }

  return NextResponse.json(report);
}
