import type { ClassifiedQuestion } from "../types/questioning.js";
import type { NormalizedTranscript } from "../types/transcript.js";
import type { MetricResult } from "../types/report.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { getLessonMetric, isTemporaryCriteria } from "../criteria/loadLessonCriteria.js";
import { validateSentenceGrounding, joinSentences, type RawSummarySentence } from "./sentenceGrounding.js";

const GRADE_ENUM = ["좋음", "보통", "개선 필요"] as const;

async function judgeGrade(
  systemPrompt: string,
  payload: Record<string, unknown>,
  schemaName: string,
  allowedGrades: readonly string[]
): Promise<{ grade: string; reason: string; citedSegmentIndices: number[] }> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema: {
          type: "object",
          properties: {
            grade: { type: "string", enum: [...allowedGrades] },
            reason: { type: "string" },
            citedSegmentIndices: { type: "array", items: { type: "integer" } },
          },
          required: ["grade", "reason", "citedSegmentIndices"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error(`${schemaName} 판정 응답이 비어있습니다.`);
  return JSON.parse(content) as { grade: string; reason: string; citedSegmentIndices: number[] };
}

interface RawL5Result {
  grade: string;
  sentences: RawSummarySentence[];
}

async function callL5Llm(
  payload: Record<string, unknown>,
  regenerationFeedback: string | null
): Promise<RawL5Result> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();

  const systemPrompt = `당신은 초등 수학 수업의 발문 흐름을 검토하는 전문가입니다.
발문을 시간 순서대로 봅니다(index가 순서). 쉬운 발문(인지·기억)에서 어려운 발문
(수렴적→확산적·평가적)으로 자연스럽게 심화되는지, 도입(기초 확인)→전개(심화)→
정리(종합)의 흐름을 보이는지 판단하세요.

grade는 "좋음"·"보통"·"개선 필요" 중 하나입니다.
sentences는 이유를 문장 단위로 쪼갠 배열입니다. 각 문장의 criterionIds는 항상
["L5"]로 고정하세요(다른 값을 쓰지 마세요). citedSegmentIndices에는 그 문장에서
실제로 언급한 발문의 index만 정확히 넣으세요 — 입력에 있는 index만 쓸 수 있고,
지어내면 안 됩니다. 근거(구체적인 발문 index)가 없는 문장은 쓰지 마세요 — 모든
문장에 최소 1개의 index가 있어야 합니다.${
    regenerationFeedback ? `\n\n이전 시도가 실패한 이유: ${regenerationFeedback} — 이 문제를 피해서 다시 만드세요.` : ""
  }`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lesson_flow_check",
        strict: true,
        schema: {
          type: "object",
          properties: {
            grade: { type: "string", enum: [...GRADE_ENUM] },
            sentences: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  criterionIds: { type: "array", items: { type: "string", enum: ["L5"] } },
                  citedSegmentIndices: { type: "array", items: { type: "integer" } },
                },
                required: ["text", "criterionIds", "citedSegmentIndices"],
                additionalProperties: false,
              },
            },
          },
          required: ["grade", "sentences"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("발문 흐름 판정 응답이 비어있습니다.");
  return JSON.parse(content) as RawL5Result;
}

/** L5: 발문 흐름 — 쉬운 발문에서 어려운 발문으로, 도입→전개→정리 흐름인지 LLM이 판단.
 *  문장마다 실제 발문 index를 근거로 달게 하고, 근거 없는 문장이나 입력에 없는
 *  index를 인용하면 1회 재생성한다(총평과 같은 검증 로직을 공유). */
export async function judgeL5(
  questions: ClassifiedQuestion[]
): Promise<{ metric: MetricResult; warnings: string[] }> {
  const metric = getLessonMetric("L5");

  if (questions.length === 0) {
    return {
      metric: {
        id: "L5",
        name: metric.name,
        grade: null,
        detail: "분석할 발문이 없어 계산할 수 없음",
        isTemporaryCriteria: isTemporaryCriteria(metric),
        evidenceSegmentIndices: [],
      },
      warnings: [],
    };
  }

  const payload = {
    questions: questions.map((q) => ({ index: q.segment.index, type: q.questionType, text: q.segment.text })),
  };
  const evidence = new Map<string, Set<number>>([["L5", new Set(questions.map((q) => q.segment.index))]]);
  const allowed = new Set(["L5"]);

  let result = await callL5Llm(payload, null);
  let problems = validateSentenceGrounding(result.sentences, evidence, allowed);

  if (problems.length > 0) {
    result = await callL5Llm(payload, problems.join("; "));
    problems = validateSentenceGrounding(result.sentences, evidence, allowed);
  }

  const grade = GRADE_ENUM.includes(result.grade as (typeof GRADE_ENUM)[number])
    ? (result.grade as MetricResult["grade"])
    : "보통";

  return {
    metric: {
      id: "L5",
      name: metric.name,
      grade,
      detail: joinSentences(result.sentences),
      isTemporaryCriteria: isTemporaryCriteria(metric),
      evidenceSegmentIndices: Array.from(new Set(result.sentences.flatMap((s) => s.citedSegmentIndices))),
    },
    warnings: problems.length > 0 ? problems.map((p) => `[L5] ${p}`) : [],
  };
}

/** L8: 실생활 연결 — 학생 경험·실생활과 연결된 발문이 있었는지. 없으면 "보통"(개선 필요는 없음). */
export async function judgeL8(transcript: NormalizedTranscript): Promise<MetricResult> {
  const metric = getLessonMetric("L8");
  const teacherSegments = transcript.segments.filter((s) => s.speaker === "teacher");

  const payload = {
    teacherUtterances: teacherSegments.map((s) => ({ index: s.index, text: s.text })),
  };

  const result = await judgeGrade(
    `당신은 초등 수학 수업을 검토하는 전문가입니다.
교사 발화 목록을 보고, 학생의 실생활 경험이나 일상 사례와 연결된 발문·설명이
있었는지 판단하세요. 있으면 "좋음", 없으면 "보통"이라고만 답하세요("개선 필요"는
쓰지 마세요 — 이 지표는 있으면 가점, 없어도 감점하지 않습니다). citedSegmentIndices에는
실생활과 연결된 실제 발화의 index만 정확히 넣으세요(입력에 없는 index를 지어내지
마세요, 없으면 빈 배열).`,
    payload,
    "real_life_connection_check",
    ["좋음", "보통"]
  );

  const validIndices = new Set(teacherSegments.map((s) => s.index));
  const groundedIndices = result.citedSegmentIndices.filter((i) => validIndices.has(i));

  return {
    id: "L8",
    name: metric.name,
    grade: result.grade === "좋음" ? "좋음" : "보통",
    detail: result.reason,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: groundedIndices,
  };
}
