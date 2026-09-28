import type { NormalizedTranscript } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import type { QuestionFindingsGroup } from "../types/suggestion.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchInChunks } from "../llm/batchWithRetry.js";
import { loadImprovementGuidelines } from "../criteria/loadImprovementGuidelines.js";

const CHUNK_SIZE = 3;

const SENTENCE_CRITERIA = new Set(["Q1", "Q2", "Q4", "Q9"]);
const BEHAVIOR_CRITERIA = new Set(["Q3", "Q5", "Q6", "Q7", "Q8"]);

export interface RawSuggestionResult {
  id: number;
  revisedQuestionText: string | null;
  suggestedAction: string | null;
  exampleTeacherLine: string | null;
  whatAndWhy: Array<{ criterionId: string; what: string; why: string }>;
  expectedStudentResponse: string;
}

export interface GenerationCase {
  group: QuestionFindingsGroup;
  waitTimeAdvice: string | null;
  regenerationFeedback: string | null;
}

function buildSystemPrompt(): string {
  const g = loadImprovementGuidelines();
  const perCriterionText = Object.entries(g.per_criterion_guidance)
    .map(([id, guidance]) => `- ${id}: ${guidance}`)
    .join("\n");

  return `당신은 초등 수학 수업의 발문을 코칭하는 전문가입니다.
각 사례는 지적사항이 있는 발문 하나입니다. 한 발문에 지적이 여러 개면 전부 해결하는
개선안 하나를 만드세요.

[톤] ${g.tone}
[길이] ${Object.entries(g.length).map(([k, v]) => `${k}: ${v}`).join(" / ")}
[피할 것]
${g.what_to_avoid.map((s) => `- ${s}`).join("\n")}

[기준별 방향]
${perCriterionText}

[중요] needsQuestionRewrite=false이면 revisedQuestionText는 반드시 null입니다.
needsBehaviorSuggestion=false이면 suggestedAction과 exampleTeacherLine은 반드시 null입니다.
waitTimeAdviceHint가 있으면(Q5가 걸린 경우), 그 문장을 suggestedAction에 그대로
포함시키세요 — 대기 시간 숫자를 직접 만들어내지 마세요.

regenerationFeedback이 있으면, 이전 시도가 왜 실패했는지 알려주는 것이니 그 문제를
피해서 다시 만드세요.

whatAndWhy는 findings에 있는 기준 id마다 하나씩, 무엇을 왜 바꿨는지 간단히 적으세요.
expectedStudentResponse는 개선 후 학생에게 기대되는 반응을 간단히 적으세요.
id는 입력값을 그대로 유지하세요.`;
}

async function callLlm(
  batch: GenerationCase[],
  transcript: NormalizedTranscript,
  conceptMatch: ConceptMatch
): Promise<RawSuggestionResult[]> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const systemPrompt = buildSystemPrompt();

  const input = {
    cases: batch.map(({ group, waitTimeAdvice, regenerationFeedback }) => {
      const idx = group.question.segment.index;
      const criteriaIds = group.findings.map((f) => f.criterionId);
      return {
        id: idx,
        originalQuestionText: group.question.segment.text,
        questionType: group.question.questionType,
        prevContext: transcript.segments[idx - 1]?.text ?? null,
        nextContext: transcript.segments[idx + 1]?.text ?? null,
        grade: transcript.meta.grade,
        standardCode: conceptMatch.standardCode,
        standardSummary: conceptMatch.standardSummary,
        findings: group.findings.map((f) => ({
          criterionId: f.criterionId,
          criterionName: f.criterionName,
          reason: f.reason,
          severity: f.severity,
          relatedSegmentTexts: f.segments.map((s) => s.text),
        })),
        needsQuestionRewrite: criteriaIds.some((id) => SENTENCE_CRITERIA.has(id)),
        needsBehaviorSuggestion: criteriaIds.some((id) => BEHAVIOR_CRITERIA.has(id)),
        waitTimeAdviceHint: waitTimeAdvice,
        regenerationFeedback,
      };
    }),
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
        name: "question_suggestions",
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
                  revisedQuestionText: { type: ["string", "null"] },
                  suggestedAction: { type: ["string", "null"] },
                  exampleTeacherLine: { type: ["string", "null"] },
                  whatAndWhy: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterionId: { type: "string" },
                        what: { type: "string" },
                        why: { type: "string" },
                      },
                      required: ["criterionId", "what", "why"],
                      additionalProperties: false,
                    },
                  },
                  expectedStudentResponse: { type: "string" },
                },
                required: [
                  "id",
                  "revisedQuestionText",
                  "suggestedAction",
                  "exampleTeacherLine",
                  "whatAndWhy",
                  "expectedStudentResponse",
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
  if (!content) throw new Error("개선안 생성 응답이 비어있습니다.");
  const parsed = JSON.parse(content) as { results: RawSuggestionResult[] };
  return parsed.results;
}

export async function generateSuggestionsForGroups(
  cases: GenerationCase[],
  transcript: NormalizedTranscript,
  conceptMatch: ConceptMatch
): Promise<Map<number, RawSuggestionResult>> {
  if (cases.length === 0) return new Map();

  return requestBatchInChunks(
    cases.map((c) => ({ id: c.group.question.segment.index, ...c })),
    CHUNK_SIZE,
    async (batch) => callLlm(batch, transcript, conceptMatch),
    "개선안 생성"
  );
}
