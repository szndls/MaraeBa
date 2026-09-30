import type { MetricResult, GoodPoint, PriorityFix } from "../types/report.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { validateSentenceGrounding, joinSentences, type RawSummarySentence } from "./sentenceGrounding.js";

interface SummaryInput {
  metrics: MetricResult[];
  goodPoints: GoodPoint[];
  priorityFixes: PriorityFix[];
}

interface RawSummaryResult {
  sentences: RawSummarySentence[];
}

async function callLlm(
  input: SummaryInput,
  allowedCriteriaIds: string[],
  mustMentionCriterionId: string | null,
  regenerationFeedback: string | null
): Promise<RawSummaryResult> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();

  const systemPrompt = `당신은 초등 수학 수업을 총평하는 전문가입니다.
아래에 이미 계산된 지표별 등급·설명, 잘한 점, 우선 개선 기준이 주어집니다.
이 데이터에만 근거해서 3~5문장의 총평을 문장 단위 배열로 쓰세요 — 여기 없는
내용을 새로 지어내거나, 목록에 없는 개념(예: "발문 중복")을 새로 만들어 쓰지
마세요. 총점이나 등급 숫자를 새로 만들지 마세요(이미 각 지표에 등급이 있습니다).

각 문장은 { text, criterionIds, citedSegmentIndices } 형태입니다.
- criterionIds: 그 문장이 실제로 말하는 내용과 정확히 일치하는 기준 id(Q1~Q9 또는
  L1~L8 중에서만) — 반드시 최소 1개 있어야 합니다. 목록에 없는 기준은 쓸 수
  없습니다. Qx와 Lx는 번호가 같아도 다른 기준입니다 — 헷갈리지 마세요. 예: Q3는
  "자문자답"(교사가 발문 후 스스로 답해버림), L3는 "학생 답 후 대기 시간"(학생이
  답한 뒤 교사가 반응하기까지의 시간)으로 전혀 다른 내용입니다. 문장 내용에 맞는
  기준을 쓰세요 — 인용할 발화 번호가 있다는 이유로 내용과 안 맞는 기준을 끌어다
  쓰면 안 됩니다. 한 문장이 여러 기준과 동시에 관련되면(예: 발문 후 대기 시간
  부족을 말하는 문장은 전체 통계인 L2와 개별 지적인 Q5 둘 다에 관련됩니다)
  criterionIds에 두 id를 함께 넣어도 됩니다.
- citedSegmentIndices: 그 문장이 실제로 언급한 발화 번호 — 반드시 최소 1개 있어야
  하고, 입력에 있는 지표·잘한 점·우선 개선 기준의 evidenceSegmentIndices/
  segmentIndices/exampleSegmentIndices 안에 있는 번호만 쓸 수 있습니다(그 기준의
  근거가 아닌 다른 기준의 발화 번호를 가져다 쓰면 안 됩니다 — 예: 발문에 대해
  말하면서 학생 발화 번호를 인용하면 안 됩니다).${
    mustMentionCriterionId
      ? `\n- 필수: 우선 개선 기준 1순위는 "${mustMentionCriterionId}"입니다. 이 총평의
  문장 중 최소 하나는 criterionIds 배열에 정확히 "${mustMentionCriterionId}"를
  포함해야 합니다 — 이 조건이 빠지면 검증에 실패합니다. 그 기준과 관련된 내용을
  쓸 때 criterionIds에 "${mustMentionCriterionId}"를 잊지 말고 넣으세요.`
      : ""
  }
- 사용 가능한 기준 id: ${allowedCriteriaIds.join(", ")}${
    regenerationFeedback ? `\n\n이전 시도가 실패한 이유: ${regenerationFeedback} — 이 문제를 피해서 다시 만드세요.` : ""
  }`;

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
            sentences: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  criterionIds: { type: "array", items: { type: "string", enum: allowedCriteriaIds } },
                  citedSegmentIndices: { type: "array", items: { type: "integer" } },
                },
                required: ["text", "criterionIds", "citedSegmentIndices"],
                additionalProperties: false,
              },
            },
          },
          required: ["sentences"],
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
 * 문장마다 criterionIds(어느 기준을 말하는지)와 citedSegmentIndices(그 기준의
 * 실제 근거 발화)를 받아서, 1) 기준이 목록에 있는지, 2) 인용 번호가 그 기준의
 * evidence 안에 있는지, 3) priorityFixes 1순위 기준이 한 번은 언급됐는지 검증한다.
 * 문제가 있으면 1회 재생성하고, 그래도 실패하면 경고만 남기고 그대로 제공한다
 * (무한 재시도 방지 — 5단계와 같은 패턴).
 */
export async function generateLessonSummary(
  metrics: MetricResult[],
  goodPoints: GoodPoint[],
  priorityFixes: PriorityFix[]
): Promise<{ summary: string; warnings: string[] }> {
  const evidenceByCriterion = new Map<string, Set<number>>();
  const addEvidence = (id: string, indices: number[]) => {
    const set = evidenceByCriterion.get(id) ?? new Set<number>();
    for (const i of indices) set.add(i);
    evidenceByCriterion.set(id, set);
  };
  for (const m of metrics) addEvidence(m.id, m.evidenceSegmentIndices);
  for (const g of goodPoints) addEvidence(g.relatedCriterionId, g.segmentIndices);
  for (const p of priorityFixes) addEvidence(p.criterionId, p.exampleSegmentIndices);

  const allowedCriteriaIds = [
    "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9",
    "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8",
  ];
  const allowedSet = new Set(allowedCriteriaIds);
  const mustMentionCriterionId = priorityFixes[0]?.criterionId ?? null;

  const input: SummaryInput = { metrics, goodPoints, priorityFixes };

  let result = await callLlm(input, allowedCriteriaIds, mustMentionCriterionId, null);
  let problems = validateSentenceGrounding(result.sentences, evidenceByCriterion, allowedSet, {
    mustMentionCriterionId,
  });

  if (problems.length > 0) {
    result = await callLlm(input, allowedCriteriaIds, mustMentionCriterionId, problems.join("; "));
    problems = validateSentenceGrounding(result.sentences, evidenceByCriterion, allowedSet, {
      mustMentionCriterionId,
    });
  }

  const warnings = problems.length > 0 ? problems.map((p) => `[총평] ${p}`) : [];

  return { summary: joinSentences(result.sentences), warnings };
}
