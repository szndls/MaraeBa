import type { ResponseEvent, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchInChunks } from "../llm/batchWithRetry.js";
import { getCriterion } from "../criteria/loadQuestioningCriteria.js";

const RESPONSE_CRITERIA_IDS = ["Q6", "Q7", "Q8"] as const;

/** 사례당 필드가 많아서 한 번에 너무 많이 넣으면 LLM이 reason을 비우거나 flag를
 *  과도하게 true로 내는 품질 저하가 관찰되어 묶음을 작게 유지한다. */
const CHUNK_SIZE = 4;

function buildSystemPrompt(): string {
  const q6 = getCriterion("Q6");
  const q7 = getCriterion("Q7");
  const q8 = getCriterion("Q8");

  return `당신은 초등 수학 수업에서 학생 답변에 대한 교사의 반응을 검토하는 전문가입니다.
각 사례는 (교사의 직전 발문, 학생 답변, 그 뒤 이어지는 교사 응답 구간, 참고용 다음 발문)으로
구성됩니다. 응답 구간은 "학생 답 직후부터 다음 교사 발문 직전까지"만 포함하고, 다음 발문
자체는 별도로 줍니다.

최종 판정(flag)은 당신이 직접 계산하지 않습니다. 아래의 "원자적 질문"들에만 각각
true/false와 이유를 답하면, 코드가 이 값들을 조합해서 최종 판정을 계산합니다. 그러니
각 원자적 질문은 서로 논리적으로 얽매이지 말고 독립적으로, 오직 그 질문 자체에만 답하세요.

1. studentAnswerWasWrong: 학생 답이 수학적으로 틀렸는가? 애매하면 false. 직전 발문이
   겹질문(하위 질문이 여러 개)이고 학생이 그중 하나에는 올바르게 답했다면, 나머지에
   답하지 않았다는 이유만으로 틀렸다고 하지 마세요.

2. nextQuestionIsFollowUp: 다음 발문(nextQuestionText)이 있다면, 그것이 방금 나온 그 답
   자체의 이유·근거·동의여부를 직접 물어보는가? 반드시 "왜", "어떻게 그렇게 생각했어요",
   "정말요", "다른 친구들은 어떻게 생각해요"처럼 그 답을 검증/설명 요청하는 표현이 있어야
   true입니다. 그 답을 사실로 전제하고 새로운 사실·다음 단계로 넘어가는 질문(설령 같은
   숫자를 이어서 쓰더라도)은 캐묻기가 아니라 false입니다. 특히 다음 발문이 이미 답을
   담고 있는 확인성 질문("~잖아, 그치?", "~죠?"처럼)이면, 그건 새로운 유도질문이지
   캐묻기가 아니므로 반드시 false입니다.
   예: 학생이 "공배수요"라고 답한 뒤, 다음 발문이 "그럼 가장 작은 공배수는 12잖아,
   그치?"라면 — 이유를 묻는 게 아니라 새로운 사실(12)을 제시하고 확인만 구하므로
   nextQuestionIsFollowUp=false입니다.

3. hasProbingInWindow: 응답 구간(responseTexts) 안에 이유 묻기·되짚기(학생 말을 다시
   정리해줌)·다른 학생에게 연결하는 표현이 있는가?

4. q6HasEvaluativeExpression: 응답 구간 안에 정답/오답을 판정하는 표현이 있는가?
   ("맞아요", "정답!", "딩동댕", "그렇지", "틀렸어요" 등 — 이 예시에 없는 방언·구어체도
   같은 기능이면 true. ${q6.name} 기준: ${q6.description})

5. q7GivesCorrectAnswerDirectly: 응답 구간 안에 교사가 정답을 직접 알려주는 문장이
   있는가? (${q7.name} 기준: ${q7.description})

6. q8HasPraiseExpression: 응답 구간 안에 학생을 칭찬하는 표현이 있는가?
   ("잘했어요", "훌륭해요", "좋아요", "대단해요" 등 — 이 예시에 없는 말도 같은 기능이면
   true. ${q8.name} 기준: ${q8.description})

7. q8IsSpecific: q8HasPraiseExpression이 true라면, 그 칭찬이 무엇이 좋았는지 구체적인
   설명을 동반하는가? (판단 규칙: ${q8.judge_rule}) q8HasPraiseExpression이 false이면
   이 값은 false로 두세요.
   판단 기준: 학생이 무엇을 했는지(방법·행동·과정·이유)를 구체적으로 언급하면
   q8IsSpecific=true입니다. 그냥 좋다/잘했다는 느낌만 있고 "무엇을" 잘했는지가 빠져있으면
   q8IsSpecific=false입니다.
   예1: "좋아요. 끝까지 이유를 찾아서 설명했네요." → "끝까지 이유를 찾아서 설명했다"는
   구체적 행동을 언급 → q8IsSpecific=true.
   예2: "배수를 나란히 써서 비교한 방법이 좋네요." → "배수를 나란히 써서 비교한 방법"이라는
   구체적 방법을 언급 → q8IsSpecific=true.
   예3: "잘했어요.", "훌륭해요." → 무엇을 잘했는지 전혀 언급 없음 → q8IsSpecific=false.

각 항목은 {value: boolean, reason: 한국어 1문장}으로 답하세요. id는 입력값을 그대로
유지하세요.`;
}

interface AtomicJudgment {
  value: boolean;
  reason: string;
}

interface LlmResponseResult {
  id: number;
  studentAnswerWasWrong: AtomicJudgment;
  nextQuestionIsFollowUp: AtomicJudgment;
  hasProbingInWindow: AtomicJudgment;
  q6HasEvaluativeExpression: AtomicJudgment;
  q7GivesCorrectAnswerDirectly: AtomicJudgment;
  q8HasPraiseExpression: AtomicJudgment;
  q8IsSpecific: AtomicJudgment;
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
      nextQuestionText: c.event.nextQuestionSegment?.text ?? null,
    })),
  };

  const judgmentSchema = {
    type: "object" as const,
    properties: {
      value: { type: "boolean" as const },
      reason: { type: "string" as const },
    },
    required: ["value", "reason"],
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
                  studentAnswerWasWrong: judgmentSchema,
                  nextQuestionIsFollowUp: judgmentSchema,
                  hasProbingInWindow: judgmentSchema,
                  q6HasEvaluativeExpression: judgmentSchema,
                  q7GivesCorrectAnswerDirectly: judgmentSchema,
                  q8HasPraiseExpression: judgmentSchema,
                  q8IsSpecific: judgmentSchema,
                },
                required: [
                  "id",
                  "studentAnswerWasWrong",
                  "nextQuestionIsFollowUp",
                  "hasProbingInWindow",
                  "q6HasEvaluativeExpression",
                  "q7GivesCorrectAnswerDirectly",
                  "q8HasPraiseExpression",
                  "q8IsSpecific",
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
  if (!content) throw new Error("응답 구간 판정 응답이 비어있습니다.");
  const parsed = JSON.parse(content) as { results: LlmResponseResult[] };
  return parsed.results;
}

export async function checkResponseHandling(events: ResponseEvent[]): Promise<QuestioningFinding[]> {
  const targets = events.filter((e) => e.responseWindowSegments.length > 0 || e.nextQuestionSegment);
  if (targets.length === 0) return [];

  const cases: ResponseCase[] = targets.map((event) => ({ event }));

  const resultMap = await requestBatchInChunks(
    cases.map((c) => ({ id: c.event.studentSegment.index, case: c })),
    CHUNK_SIZE,
    async (batch) => callLlm(batch.map((b) => b.case)),
    "응답 구간 판정"
  );

  const findings: QuestioningFinding[] = [];

  for (const c of cases) {
    const result = resultMap.get(c.event.studentSegment.index);
    if (!result) continue;

    const relevantSegments = [
      ...(c.event.precedingQuestionSegment ? [c.event.precedingQuestionSegment] : []),
      c.event.studentSegment,
      ...c.event.responseWindowSegments,
    ];

    // 응답 구간이 비어있으면(다음이 바로 다음 발문이면) 평가·칭찬 발화 자체가
    // 없으므로 Q6/Q7/Q8 모두 구조적으로 성립할 수 없다.
    const hasResponseContent = c.event.responseWindowSegments.length > 0;
    const noFollowUp = !result.hasProbingInWindow.value && !result.nextQuestionIsFollowUp.value;

    const q6 =
      hasResponseContent && result.q6HasEvaluativeExpression.value && noFollowUp;
    const q7 =
      hasResponseContent &&
      result.studentAnswerWasWrong.value &&
      result.q7GivesCorrectAnswerDirectly.value &&
      noFollowUp;
    const q8 =
      hasResponseContent && result.q8HasPraiseExpression.value && !result.q8IsSpecific.value;

    const gated = { Q6: q6, Q7: q7, Q8: q8 };
    const reasons: Record<"Q6" | "Q7" | "Q8", string> = {
      Q6: `${result.q6HasEvaluativeExpression.reason} / ${result.hasProbingInWindow.reason} / ${result.nextQuestionIsFollowUp.reason}`,
      Q7: `${result.studentAnswerWasWrong.reason} / ${result.q7GivesCorrectAnswerDirectly.reason} / ${result.hasProbingInWindow.reason}`,
      Q8: `${result.q8HasPraiseExpression.reason} / ${result.q8IsSpecific.reason}`,
    };

    for (const id of RESPONSE_CRITERIA_IDS) {
      if (!gated[id]) continue;
      const criterion = getCriterion(id);
      findings.push({
        criterionId: id,
        criterionName: criterion.name,
        severity: criterion.severity ?? "미지정",
        segments: relevantSegments,
        reason: reasons[id],
        detect: "llm",
      });
    }
  }

  return findings;
}
