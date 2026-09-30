import type { MetricResult, GoodPoint, PriorityFix } from "../types/report.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";

interface SummaryInput {
  metrics: MetricResult[];
  goodPoints: GoodPoint[];
  priorityFixes: PriorityFix[];
}

interface RawSummaryResult {
  summary: string;
  citedSegmentIndices: number[];
}

async function callLlm(input: SummaryInput): Promise<RawSummaryResult> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();

  const systemPrompt = `당신은 초등 수학 수업을 총평하는 전문가입니다.
아래에 이미 계산된 지표별 등급·설명, 잘한 점, 우선 개선 기준이 주어집니다.
이 데이터에만 근거해서 3~5문장의 총평을 한국어로 쓰세요 — 여기 없는 내용을
새로 지어내거나 일반론만 늘어놓지 마세요. 총점이나 등급 숫자를 새로 만들지
마세요(이미 각 지표에 등급이 있습니다). 발화 번호를 인용할 일이 있으면,
반드시 입력에 있는 evidenceSegmentIndices 안의 번호만 쓰세요 — 그 목록에 없는
번호를 지어내면 안 됩니다. citedSegmentIndices에는 총평 본문에서 실제로 언급한
발화 번호를 전부 나열하세요(없으면 빈 배열).`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lesson_summary",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            citedSegmentIndices: { type: "array", items: { type: "integer" } },
          },
          required: ["summary", "citedSegmentIndices"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("총평 생성 응답이 비어있습니다.");
  return JSON.parse(content) as RawSummaryResult;
}

/**
 * 총평은 LLM이 쓰지만, 근거는 계산된 지표·잘한 점·우선 개선 기준에만 있어야 한다.
 * 인용한 발화 번호가 그 근거들에 실제로 포함된 번호인지 코드로 검증하고, 근거 없는
 * 번호를 인용했으면 1회 재생성한다. 재생성 후에도 실패하면 경고만 남기고 그대로
 * 제공한다(무한 재시도 방지 — 5단계와 같은 패턴).
 */
export async function generateLessonSummary(
  metrics: MetricResult[],
  goodPoints: GoodPoint[],
  priorityFixes: PriorityFix[]
): Promise<{ summary: string; warnings: string[] }> {
  const allowedIndices = new Set<number>([
    ...metrics.flatMap((m) => m.evidenceSegmentIndices),
    ...goodPoints.flatMap((g) => g.segmentIndices),
    ...priorityFixes.flatMap((p) => p.exampleSegmentIndices),
  ]);

  const input: SummaryInput = { metrics, goodPoints, priorityFixes };

  let result = await callLlm(input);
  let ungrounded = result.citedSegmentIndices.filter((i) => !allowedIndices.has(i));

  if (ungrounded.length > 0) {
    result = await callLlm(input);
    ungrounded = result.citedSegmentIndices.filter((i) => !allowedIndices.has(i));
  }

  const warnings: string[] =
    ungrounded.length > 0
      ? [`⚠️ 총평에 근거 없는 발화 번호 인용이 남아있음: [${ungrounded.join(", ")}]`]
      : [];

  return { summary: result.summary, warnings };
}
