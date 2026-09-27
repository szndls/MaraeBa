import type { QuestionCandidate, ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchWithRetry } from "../llm/batchWithRetry.js";
import { getCriterion, getQuestionTypes, loadQuestioningCriteria } from "../criteria/loadQuestioningCriteria.js";

const QUESTION_LEVEL_CRITERIA_IDS = ["Q1", "Q2", "Q4", "Q9"] as const;
type QuestionLevelCriterionId = (typeof QUESTION_LEVEL_CRITERIA_IDS)[number];

function buildSystemPrompt(questionTypes: string[]): string {
  const file = loadQuestioningCriteria();
  const typeDescriptions = Object.entries(file.question_type_scheme.types)
    .map(([label, desc]) => `- "${label}": ${desc}`)
    .join("\n");

  const criteriaText = QUESTION_LEVEL_CRITERIA_IDS.map((id) => {
    const c = getCriterion(id);
    const parts = [`- ${id} (${c.name}): ${c.description}`];
    if (c.judge_rule) parts.push(`  판단 규칙: ${c.judge_rule}`);
    if (c.hint_for_code) parts.push(`  참고: ${c.hint_for_code}`);
    if (c.note) parts.push(`  주의: ${c.note}`);
    return parts.join("\n");
  }).join("\n");

  return `당신은 초등 수학 수업의 교사 발화 후보 목록을 검토하는 전문가입니다.
각 후보는 물음표나 의문형 어미로 끝나서 "발문일 가능성이 있다"고 코드가 골라낸 것입니다.
실제로 발문이 아닌 경우(예: 의문형 어미지만 질문이 아닌 서술)도 있으니, isQuestion으로 먼저 판단하세요.

[발문 유형 분류 (${file.question_type_scheme.name})]
${typeDescriptions}
${file.question_type_scheme.note}

isQuestion이 false이면 questionType은 그래도 가장 가까운 유형으로 채우되, 이후 결과에서는 제외됩니다.

[발문 단위로 같이 판정할 기준]
${criteriaText}

각 판정 항목(q1_compound, q2_vague, q4_leading, q9_named_first)은 flag(boolean)와 reason(한국어 1문장)을 반환하세요.
id는 입력값을 그대로 유지하세요.`;
}

interface LlmFlag {
  flag: boolean;
  reason: string;
}

interface LlmQuestionResult {
  id: number;
  isQuestion: boolean;
  questionType: string;
  q1_compound: LlmFlag;
  q2_vague: LlmFlag;
  q4_leading: LlmFlag;
  q9_named_first: LlmFlag;
}

async function callLlm(
  batch: QuestionCandidate[],
  questionTypes: string[]
): Promise<LlmQuestionResult[]> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const systemPrompt = buildSystemPrompt(questionTypes);

  const input = {
    candidates: batch.map((c) => ({
      id: c.segment.index,
      text: c.segment.text,
      questionMarkCount: c.questionMarkCount,
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
        name: "question_classification",
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
                  isQuestion: { type: "boolean" },
                  questionType: { type: "string", enum: questionTypes },
                  q1_compound: flagSchema,
                  q2_vague: flagSchema,
                  q4_leading: flagSchema,
                  q9_named_first: flagSchema,
                },
                required: [
                  "id",
                  "isQuestion",
                  "questionType",
                  "q1_compound",
                  "q2_vague",
                  "q4_leading",
                  "q9_named_first",
                ],
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
  if (!content) throw new Error("발문 분류 응답이 비어있습니다.");
  const parsed = JSON.parse(content) as { results: LlmQuestionResult[] };
  return parsed.results;
}

export async function classifyAndCheckQuestions(
  candidates: QuestionCandidate[]
): Promise<{ questions: ClassifiedQuestion[]; findings: QuestioningFinding[] }> {
  if (candidates.length === 0) return { questions: [], findings: [] };

  const questionTypes = getQuestionTypes();
  const resultMap = await requestBatchWithRetry(
    candidates.map((c) => ({ id: c.segment.index, candidate: c })),
    async (batch) => callLlm(batch.map((b) => b.candidate), questionTypes),
    "발문 분류"
  );

  const questions: ClassifiedQuestion[] = [];
  const findings: QuestioningFinding[] = [];

  const criterionMeta: Record<QuestionLevelCriterionId, { key: keyof LlmQuestionResult }> = {
    Q1: { key: "q1_compound" },
    Q2: { key: "q2_vague" },
    Q4: { key: "q4_leading" },
    Q9: { key: "q9_named_first" },
  };

  for (const candidate of candidates) {
    const result = resultMap.get(candidate.segment.index);
    if (!result) continue; // 재시도 후에도 누락된 경우

    if (!result.isQuestion) continue; // 발문이 아니면 제외

    questions.push({
      segment: candidate.segment,
      questionType: result.questionType,
      questionMarkCount: candidate.questionMarkCount,
    });

    for (const id of QUESTION_LEVEL_CRITERIA_IDS) {
      const flag = result[criterionMeta[id].key] as LlmFlag;
      if (!flag.flag) continue;
      const criterion = getCriterion(id);
      findings.push({
        criterionId: id,
        criterionName: criterion.name,
        severity: criterion.severity ?? "미지정",
        segments: [candidate.segment],
        reason: flag.reason,
        detect: "llm",
      });
    }
  }

  return { questions, findings };
}
