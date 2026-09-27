import type { NormalizedTranscript } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { loadConceptGuessGuidelinesText } from "../criteria/loadCriteria.js";
import { buildStandardsCatalog, getGradeBandForGrade } from "../criteria/loadMathTerms.js";

function buildSystemPrompt(standardCodes: string[]): string {
  const guidelines = loadConceptGuessGuidelinesText();

  return `당신은 초등 수학 수업의 교사 발화를 보고, 지금 배우고 있는 개념이 어떤
성취기준에 해당하는지 추측하는 전문가입니다.

${guidelines}

standardCode는 반드시 아래 목록 중 하나여야 합니다:
${standardCodes.join(", ")}

evidenceSegmentIndices에는 판단 근거로 삼은 교사 발화의 id를 넣으세요 (1개 이상).`;
}

interface LlmConceptResult {
  standardCode: string;
  evidenceSegmentIndices: number[];
  rationale: string;
}

export async function matchConcept(transcript: NormalizedTranscript): Promise<ConceptMatch> {
  const grade = transcript.meta.grade;
  const band = getGradeBandForGrade(grade);
  const catalog = buildStandardsCatalog(band);

  if (catalog.length === 0) {
    throw new Error(`학년군 ${band.band}에 등록된 성취기준이 없습니다 (math-terms.json 확인 필요).`);
  }

  const teacherSegments = transcript.segments.filter((s) => s.speaker === "teacher");
  if (teacherSegments.length === 0) {
    throw new Error("교사 발화가 없어 개념을 추측할 수 없습니다.");
  }

  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const standardCodes = catalog.map((c) => c.code);
  const systemPrompt = buildSystemPrompt(standardCodes);

  const input = {
    grade,
    band: band.band,
    candidateStandards: catalog,
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
        name: "concept_match",
        strict: true,
        schema: {
          type: "object",
          properties: {
            standardCode: { type: "string", enum: standardCodes },
            evidenceSegmentIndices: {
              type: "array",
              minItems: 1,
              items: { type: "integer" },
            },
            rationale: { type: "string" },
          },
          required: ["standardCode", "evidenceSegmentIndices", "rationale"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("개념 추측 응답이 비어있습니다.");

  const parsed = JSON.parse(content) as LlmConceptResult;

  const catalogEntry = catalog.find((c) => c.code === parsed.standardCode);
  if (!catalogEntry) {
    throw new Error(`LLM이 목록에 없는 성취기준 코드를 반환했습니다: ${parsed.standardCode}`);
  }

  const evidenceSegments = transcript.segments.filter((s) =>
    parsed.evidenceSegmentIndices.includes(s.index)
  );

  return {
    grade,
    band: band.band,
    areaName: catalogEntry.areaName,
    standardCode: catalogEntry.code,
    standardSummary: catalogEntry.summary,
    rationale: parsed.rationale,
    evidenceSegments,
    source: "ai",
  };
}
