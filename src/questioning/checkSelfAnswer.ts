import type { NormalizedTranscript } from "../types/transcript.js";
import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchInChunks } from "../llm/batchWithRetry.js";

const CHUNK_SIZE = 5;
import { getCriterion } from "../criteria/loadQuestioningCriteria.js";

interface SelfAnswerCandidate {
  question: ClassifiedQuestion;
  nextSegment: NormalizedTranscript["segments"][number];
  gapSec: number;
}

/** criteria 파일의 hint_for_code 문구("...간격이 3초 미만이면...")에서 초 단위 숫자를 그대로 읽어온다 */
function getGapThresholdSecFromHint(hint: string | undefined): number {
  if (!hint) throw new Error("Q3 criterion에 hint_for_code가 없어 간격 기준을 읽을 수 없습니다.");
  const match = hint.match(/(\d+(\.\d+)?)\s*초/);
  if (!match) {
    throw new Error(`Q3 hint_for_code에서 초 단위 숫자를 찾을 수 없습니다: "${hint}"`);
  }
  return Number(match[1]);
}

function findCandidates(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[],
  gapThresholdSec: number
): SelfAnswerCandidate[] {
  const candidates: SelfAnswerCandidate[] = [];

  for (const question of questions) {
    const nextSegment = transcript.segments[question.segment.index + 1];
    if (!nextSegment || nextSegment.speaker !== "teacher") continue;

    const gapSec = nextSegment.start - question.segment.end;
    if (gapSec < gapThresholdSec) {
      candidates.push({ question, nextSegment, gapSec });
    }
  }

  return candidates;
}

interface LlmSelfAnswerResult {
  id: number;
  isSelfAnswer: boolean;
  reason: string;
}

async function callLlm(batch: SelfAnswerCandidate[]): Promise<LlmSelfAnswerResult[]> {
  const criterion = getCriterion("Q3");
  const client = getOpenAIClient();
  const model = getAnalysisModel();

  const systemPrompt = `당신은 초등 수학 수업에서 교사가 스스로 낸 발문에 스스로 답해버리는
"자문자답"을 확인하는 전문가입니다.

기준(${criterion.id} ${criterion.name}): ${criterion.description}
판단 규칙: ${criterion.judge_rule}

각 사례는 교사의 발문과, 그 직후(3초 미만) 이어진 교사 자신의 발화로 구성됩니다.
바로 뒤 발화가 정말로 그 질문에 대한 답인지 판단하세요 (단순히 말을 이어가거나
다른 주제로 넘어간 경우는 자문자답이 아닙니다). id는 입력값을 그대로 유지하세요.`;

  const input = {
    cases: batch.map((c) => ({
      id: c.question.segment.index,
      questionText: c.question.segment.text,
      nextTeacherText: c.nextSegment.text,
      gapSec: Math.round(c.gapSec * 10) / 10,
    })),
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
        name: "self_answer_check",
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
                  isSelfAnswer: { type: "boolean" },
                  reason: { type: "string" },
                },
                required: ["id", "isSelfAnswer", "reason"],
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
  if (!content) throw new Error("자문자답 확인 응답이 비어있습니다.");
  const parsed = JSON.parse(content) as { results: LlmSelfAnswerResult[] };
  return parsed.results;
}

export async function checkSelfAnswer(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[]
): Promise<QuestioningFinding[]> {
  const gapThresholdSec = getGapThresholdSecFromHint(getCriterion("Q3").hint_for_code);
  const candidates = findCandidates(transcript, questions, gapThresholdSec);
  if (candidates.length === 0) return [];

  const resultMap = await requestBatchInChunks(
    candidates.map((c) => ({ id: c.question.segment.index, candidate: c })),
    CHUNK_SIZE,
    async (batch) => callLlm(batch.map((b) => b.candidate)),
    "자문자답 확인"
  );

  const criterion = getCriterion("Q3");
  const findings: QuestioningFinding[] = [];

  for (const candidate of candidates) {
    const result = resultMap.get(candidate.question.segment.index);
    if (!result || !result.isSelfAnswer) continue;

    findings.push({
      criterionId: "Q3",
      criterionName: criterion.name,
      severity: criterion.severity ?? "미지정",
      segments: [candidate.question.segment, candidate.nextSegment],
      reason: `(간격 ${candidate.gapSec.toFixed(1)}초) ${result.reason}`,
      detect: "code+llm",
    });
  }

  return findings;
}
