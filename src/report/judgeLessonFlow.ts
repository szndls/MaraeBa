import type { ClassifiedQuestion } from "../types/questioning.js";
import type { NormalizedTranscript } from "../types/transcript.js";
import type { MetricResult } from "../types/report.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { getLessonMetric, isTemporaryCriteria } from "../criteria/loadLessonCriteria.js";

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

/** L5: 발문 흐름 — 쉬운 발문에서 어려운 발문으로, 도입→전개→정리 흐름인지 LLM이 판단. */
export async function judgeL5(questions: ClassifiedQuestion[]): Promise<MetricResult> {
  const metric = getLessonMetric("L5");

  if (questions.length === 0) {
    return {
      id: "L5",
      name: metric.name,
      grade: null,
      detail: "분석할 발문이 없어 계산할 수 없음",
      isTemporaryCriteria: isTemporaryCriteria(metric),
      evidenceSegmentIndices: [],
    };
  }

  const payload = {
    questions: questions.map((q) => ({ index: q.segment.index, type: q.questionType, text: q.segment.text })),
  };

  const result = await judgeGrade(
    `당신은 초등 수학 수업의 발문 흐름을 검토하는 전문가입니다.
발문을 시간 순서대로 봅니다(index가 순서). 쉬운 발문(인지·기억)에서 어려운 발문
(수렴적→확산적·평가적)으로 자연스럽게 심화되는지, 도입(기초 확인)→전개(심화)→
정리(종합)의 흐름을 보이는지 판단하세요. "좋음"·"보통"·"개선 필요" 중 하나와
이유를 답하세요. citedSegmentIndices에는 이유에서 언급한 발문의 index만 정확히
넣으세요(입력에 없는 index를 지어내지 마세요).`,
    payload,
    "lesson_flow_check",
    GRADE_ENUM
  );

  const validIndices = new Set(questions.map((q) => q.segment.index));
  const groundedIndices = result.citedSegmentIndices.filter((i) => validIndices.has(i));

  return {
    id: "L5",
    name: metric.name,
    grade: GRADE_ENUM.includes(result.grade as (typeof GRADE_ENUM)[number]) ? (result.grade as MetricResult["grade"]) : "보통",
    detail: result.reason,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: groundedIndices,
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
