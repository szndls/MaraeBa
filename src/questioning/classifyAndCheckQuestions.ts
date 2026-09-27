import type { QuestionCandidate, ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchWithRetry } from "../llm/batchWithRetry.js";
import { getCriterion, getQuestionTypes, loadQuestioningCriteria } from "../criteria/loadQuestioningCriteria.js";

const QUESTION_LEVEL_CRITERIA_IDS = ["Q1", "Q2", "Q4", "Q9"] as const;
type QuestionLevelCriterionId = (typeof QUESTION_LEVEL_CRITERIA_IDS)[number];

/** criteria 파일의 description에 '...'로 인용된 예시 어미를 뽑아온다 (Q4: '~죠?','그렇지?','맞죠?') */
function extractQuotedExamples(text: string): string[] {
  return Array.from(text.matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[!?.]+$/u, "").trim();
}

/** Q4는 마지막 질문 문장이 실제로 이 어미들로 끝나는지 코드로 먼저 걸러서, LLM이
 *  근거 없이(어미가 전혀 없는데도) Q4로 판정하는 것을 막는다. */
function isQ4EndingCandidate(text: string, patterns: string[]): boolean {
  const trimmed = stripTrailingPunct(text);
  return patterns.some((p) => trimmed.endsWith(stripTrailingPunct(p.replace(/^~/, ""))));
}

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

[Q4 판정 시 특히 주의] 발화 안에 실제로 답을 요구하는 질문 문장이 여러 개 있을 수 있습니다.
그중 "마지막"(가장 실질적인) 질문 문장만 보고 판단하세요: 그 질문이 "~죠?", "그렇지?",
"맞죠?", "~이지요?"처럼 답을 이미 문장 안에 넣어두고 "네/아니요"만 하면 되는 짧은
확인성 질문이면 Q4입니다. 예: "3분의 1이죠?"는 답(3분의 1)을 이미 말해버리고 확인만
요구하므로 Q4입니다. 반대로 "네, 8분의 1. 그럼 4분의 1이랑 8분의 1 중에 뭐가 더 클까요?"는
앞부분이 이전 답을 확인해주는 되짚기이고, 진짜 질문("뭐가 더 클까요?")은 학생이 직접
비교해서 답을 골라야 하는 질문이라 답을 미리 주지 않았으므로 Q4가 아닙니다. 즉, 앞에
확인 표현이 있어도 실제 질문이 "네/아니요"를 넘어서는 새로운 정보(비교·설명·계산 결과 등)를
요구하면 Q4가 아닙니다.
이런 발화가 동시에 Q3(자문자답 후보)로도 분류되는 경우가 있는데, Q3와 Q4는 서로 독립적인
기준이므로 둘 다 해당하면 둘 다 flag=true로 표시하세요 (Q4 판정은 Q3 여부와 무관합니다).

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

  const q4Patterns = extractQuotedExamples(getCriterion("Q4").description);

  for (const candidate of candidates) {
    const result = resultMap.get(candidate.segment.index);
    if (!result) continue; // 재시도 후에도 누락된 경우

    if (!result.isQuestion) continue; // 발문이 아니면 제외

    questions.push({
      segment: candidate.segment,
      questionType: result.questionType,
      questionMarkCount: candidate.questionMarkCount,
    });

    const q4IsCandidate = isQ4EndingCandidate(candidate.segment.text, q4Patterns);

    for (const id of QUESTION_LEVEL_CRITERIA_IDS) {
      const flag = result[criterionMeta[id].key] as LlmFlag;
      // Q4는 어미 패턴이 실제로 없으면 LLM 판단과 무관하게 무조건 제외 (환각 방지)
      if (id === "Q4" && !q4IsCandidate) continue;
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
