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

term이 제외 목록의 단어를 부분으로라도 포함하면 안 됩니다. 어려운 어휘가 제외
목록의 단어와 조사로 붙어서 하나의 구절처럼 보여도(예: "~의 ~"), 제외 목록
단어 부분은 반드시 잘라내고 나머지 어려운 부분만 term으로 적으세요. "둘을 합친
구절 전체가 그 개념을 가리킨다"고 느껴지더라도 예외 없이 자르세요 — 제외
목록 단어는 이미 다른 단계에서 처리되므로, 거기 포함되면 그 용어가 중복으로
잡힌 것과 같습니다.
예: 제외 목록에 "최소공배수"가 있고 발화가 "최소공배수의 귀납적 성질을 보면
항상 원래 수보다 커요"라면, term은 "최소공배수의 귀납적 성질"이 아니라 "귀납적
성질"만 적으세요(앞의 "최소공배수의"는 잘라냄).

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
  // 긴 용어부터 검사해야 "단위분수"가 "분수"보다 먼저 매치된다(둘 다 제외 목록에
  // 있을 때 더 많이 잘라내는 쪽이 맞음).
  const excludedTermsByLength = [...excludedTerms].sort((a, b) => b.length - a.length);
  // 제외 용어 뒤에 자연스럽게 붙는 조사들 — 이 중 하나가 붙어 있으면 조사까지 같이 뗀다.
  const PARTICLES = ["의", "은", "는", "이", "가", "을", "를", "와", "과", "로", "으로", "에", "에서"];

  /**
   * LLM이 제외 지시를 무시하고 이미 교육과정 목록에 있는 용어를 term 앞에 붙여서
   * 반환하는 경우가 있다(예: "단위분수"가 제외 목록에 있는데 "단위분수의 대소
   * 관계"를 통째로 term으로 냄 — 프롬프트만으로는 100% 막히지 않아서 실측으로
   * 확인됨). term이 제외 용어로 시작하면 그 부분(+조사)을 코드로 잘라낸다.
   */
  function stripLeadingExcludedTerm(term: string): string {
    for (const excluded of excludedTermsByLength) {
      if (!term.startsWith(excluded)) continue;
      let rest = term.slice(excluded.length);
      for (const p of PARTICLES) {
        if (rest.startsWith(p)) {
          rest = rest.slice(p.length);
          break;
        }
      }
      return rest.trim();
    }
    return term;
  }

  return parsed.findings
    .map((f) => ({ ...f, term: stripLeadingExcludedTerm(f.term) }))
    .filter((f) => f.term.length > 0 && !excludedSet.has(f.term))
    .map((f) => ({
      term: f.term,
      category: "unlisted_hard_word" as const,
      reason: f.reason,
      foundInSegments: teacherSegments.filter((s) => f.evidenceSegmentIndices.includes(s.index)),
      basis: "llm" as const,
    }));
}
