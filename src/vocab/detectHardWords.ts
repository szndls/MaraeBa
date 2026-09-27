import type { NormalizedTranscript } from "../types/transcript.js";
import type { VocabFinding } from "../types/vocab.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { loadVocabDetectionNotesText } from "../criteria/loadCriteria.js";
import { buildTermIndex } from "../criteria/loadMathTerms.js";

function buildSystemPrompt(excludedTerms: string[]): string {
  const guidelines = loadVocabDetectionNotesText();

  return `당신은 초등 수학 수업 교사 발화에서, 교육과정 용어 목록에는 없지만
학생 학년 수준에 비해 어려울 수 있는 일반 어휘를 찾는 전문가입니다.

${guidelines}

아래 목록에 있는 단어는 이미 교육과정 용어로 처리되었으니 절대 다시 찾지 마세요:
${excludedTerms.join(", ")}

찾은 게 없으면 findings를 빈 배열로 반환하세요.`;
}

interface LlmHardWordResult {
  term: string;
  evidenceSegmentIndices: number[];
  reason: string;
}

export async function detectHardWords(
  transcript: NormalizedTranscript,
  grade: number
): Promise<VocabFinding[]> {
  const teacherSegments = transcript.segments.filter((s) => s.speaker === "teacher");
  if (teacherSegments.length === 0) return [];

  const excludedTerms = Array.from(buildTermIndex().keys());

  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const systemPrompt = buildSystemPrompt(excludedTerms);

  const input = {
    grade,
    teacherUtterances: teacherSegments.map((s) => ({ id: s.index, text: s.text })),
  };

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "hard_word_findings",
        strict: true,
        schema: {
          type: "object",
          properties: {
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  term: { type: "string" },
                  evidenceSegmentIndices: {
                    type: "array",
                    minItems: 1,
                    items: { type: "integer" },
                  },
                  reason: { type: "string" },
                },
                required: ["term", "evidenceSegmentIndices", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["findings"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("어려운 어휘 판단 응답이 비어있습니다.");

  const parsed = JSON.parse(content) as { findings: LlmHardWordResult[] };
  const excludedSet = new Set(excludedTerms);

  // LLM이 제외 지시를 무시하고 이미 교육과정 목록에 있는 용어를 다시 반환하는 경우가 있어
  // (프롬프트만으로는 100% 보장 안 됨) 코드에서 한 번 더 걸러낸다.
  return parsed.findings
    .filter((f) => !excludedSet.has(f.term))
    .map((f) => ({
      term: f.term,
      category: "unlisted_hard_word" as const,
      reason: f.reason,
      foundInSegments: teacherSegments.filter((s) => f.evidenceSegmentIndices.includes(s.index)),
      basis: "llm" as const,
    }));
}
