import type { ResponseEvent, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchWithRetry } from "../llm/batchWithRetry.js";
import { getCriterion } from "../criteria/loadQuestioningCriteria.js";

const RESPONSE_CRITERIA_IDS = ["Q6", "Q7", "Q8"] as const;

function buildSystemPrompt(): string {
  const criteriaText = RESPONSE_CRITERIA_IDS.map((id) => {
    const c = getCriterion(id);
    const parts = [`- ${id} (${c.name}): ${c.description}`];
    if (c.judge_rule) parts.push(`  판단 규칙: ${c.judge_rule}`);
    return parts.join("\n");
  }).join("\n");

  return `당신은 초등 수학 수업에서 학생 답변에 대한 교사의 반응을 검토하는 전문가입니다.
각 사례는 (교사의 직전 발문, 학생 답변, 그 뒤 이어지는 교사 응답 구간)으로 구성됩니다.

먼저 studentAnswerWasWrong(학생 답이 수학적으로 틀렸는지)을 판단하세요. 질문 내용과 답을
비교해서 판단하고, 애매하면 false로 두세요.

[판정할 기준]
${criteriaText}

id는 입력값을 그대로 유지하세요.`;
}

interface LlmFlag {
  flag: boolean;
  reason: string;
}

interface LlmResponseResult {
  id: number;
  studentAnswerWasWrong: boolean;
  q6: LlmFlag;
  q7: LlmFlag;
  q8: LlmFlag;
}

interface ResponseCase {
  event: ResponseEvent;
}

async function callLlm(batch: ResponseCase[]): Promise<LlmResponseResult[]> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const systemPrompt = buildSystemPrompt();

  const input = {
    cases: batch.map((c) => ({
      id: c.event.studentSegment.index,
      precedingQuestionText: c.event.precedingQuestionSegment?.text ?? null,
      studentAnswerText: c.event.studentSegment.text,
      responseTexts: c.event.responseWindowSegments.map((s) => s.text),
    })),
  };

  const flagSchema = {
    type: "object" as const,
    properties: {
      flag: { type: "boolean" as const },
      reason: { type: "string" as const },
    },
    required: ["flag", "reason"],
    additionalProperties: false as const,
  };

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
        name: "response_handling_check",
        strict: true,
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  studentAnswerWasWrong: { type: "boolean" },
                  q6: flagSchema,
                  q7: flagSchema,
                  q8: flagSchema,
                },
                required: ["id", "studentAnswerWasWrong", "q6", "q7", "q8"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("응답 구간 판정 응답이 비어있습니다.");
  const parsed = JSON.parse(content) as { results: LlmResponseResult[] };
  return parsed.results;
}

export async function checkResponseHandling(events: ResponseEvent[]): Promise<QuestioningFinding[]> {
  const targets = events.filter((e) => e.responseWindowSegments.length > 0);
  if (targets.length === 0) return [];

  const resultMap = await requestBatchWithRetry(
    targets.map((e) => ({ id: e.studentSegment.index, event: e })),
    async (batch) => callLlm(batch.map((b) => ({ event: b.event }))),
    "응답 구간 판정"
  );

  const findings: QuestioningFinding[] = [];

  for (const event of targets) {
    const result = resultMap.get(event.studentSegment.index);
    if (!result) continue;

    const relevantSegments = [
      ...(event.precedingQuestionSegment ? [event.precedingQuestionSegment] : []),
      event.studentSegment,
      ...event.responseWindowSegments,
    ];

    for (const id of RESPONSE_CRITERIA_IDS) {
      const flag = result[id.toLowerCase() as "q6" | "q7" | "q8"];
      if (!flag.flag) continue;
      const criterion = getCriterion(id);
      findings.push({
        criterionId: id,
        criterionName: criterion.name,
        severity: criterion.severity ?? "미지정",
        segments: relevantSegments,
        reason: flag.reason,
        detect: "llm",
      });
    }
  }

  return findings;
}
