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
   q8IsSpecific=false입니다. 학생에게 "무엇이 좋았는지 말해 줄래요?"처럼 되묻는 것은
   교사가 직접 칭찬한 게 아니므로 q8HasPraiseExpression=false로 판단하세요(칭찬 자체가 없음).
   예1: "숫자를 하나씩 세어가며 확인한 방법이 좋네요." → "숫자를 하나씩 세어가며 확인한
   방법"이라는 구체적 방법을 언급 → q8IsSpecific=true.
   예2: "그 이유를 차근차근 짚어서 설명한 점이 좋아요." → "이유를 차근차근 짚어서
   설명한" 구체적 행동을 언급 → q8IsSpecific=true.
   예3: "잘했어요.", "훌륭해요." → 무엇을 잘했는지 전혀 언급 없음 → q8IsSpecific=false.

8. reflectsStudentWords: 응답 구간 안에 교사가 학생이 한 말·행동을 구체적으로
   되짚어(요약·재진술) 표현하는가? 칭찬 표현("좋아요", "잘했어요" 등)이 전혀 없어도
   괜찮습니다 — 학생이 말한 내용을 교사가 구체적으로 다시 언급했으면 true입니다.
   예: "4씩 커진다고 했구나." (칭찬 없이 학생 말을 되짚음 → true)
   예: "학생이 4의 배수를 나열했어요." 같은 일반적 요약이 아니라, 학생이 실제로 한
   말·방법의 구체적 내용을 담아야 true입니다.

9. addressesStudentDirectly: 이 응답 구간 문장을, 교사가 학생을 보면서 그 자리에서
   소리 내어 말한다고 상상해 보세요. 학생이 그 말을 듣고 "네?"라고 반응할 만큼
   자연스러운 대사라면 true입니다. 반대로 교실 상황을 설명하거나 교사 자신이 무엇을
   해야 하는지 서술·권장하는 문장(마치 수업 지도안이나 코칭 메모에 적힌 문장처럼
   들림)이면, 설령 "학생"이라는 단어가 없어도 false입니다. 주어가 암묵적으로
   "교사(나)"인 조언·서술문(예: "~하는 것이 좋겠어요", "~하면 좋을 것 같다", "~해야
   한다", "~하지 않고 ~해 보는 것이 좋겠어요")은 전부 false — 이런 문장은 교사가
   학생 앞에서 그대로 말하면 어색합니다. 학생에게 직접 묻거나, 학생의 말에 반응하거나,
   학생을 부르는 등 그 자리에서 학생에게 하는 말이면 true입니다.
   예: "정답이라고 말해주지 않고, 학생의 설명을 더 깊이 있게 들어보는 것이 좋겠어요."
   → 교사가 스스로 어떻게 할지 서술하는 조언문, 학생 앞에서 소리 내어 말하면 어색함
   → false.
   예: "그래서 그렇게 생각한 이유가 뭐예요?" → 학생에게 직접 묻는 대사 → true.

10. reflectionAccurate: 응답 구간이 학생이 한 말·행동·답을 구체적으로 언급(요약·
    재진술·인용)하고 있다면, 그 내용이 studentAnswerText(실제 학생 답변)와 실제로
    일치하는가? 응답 구간이 학생이 한 말을 구체적으로 언급하지 않는다면(그냥 질문만
    하거나 칭찬만 하는 등) 이 값은 true로 두세요. 학생이 하지 않은 말을 지어내거나
    실제 답과 다른 내용으로 바꿔 말했다면 false입니다 — reflectsStudentWords가
    false이더라도, 응답이 학생 답을 언급하는 척하며 다른 내용을 지어냈다면 이 값은
    여전히 false여야 합니다.
    예: 학생 답변이 "4분의 1이요."인데 응답이 "20을 4로 나누면 5가 된다고 했구나."라면
    → 학생이 하지 않은 말을 지어냄 → false.

각 항목은 {value: boolean, reason: 한국어 1문장}으로 답하세요. id는 입력값을 그대로
유지하세요.`;
}

export interface AtomicJudgment {
  value: boolean;
  reason: string;
}

export interface LlmResponseResult {
  id: number;
  studentAnswerWasWrong: AtomicJudgment;
  nextQuestionIsFollowUp: AtomicJudgment;
  hasProbingInWindow: AtomicJudgment;
  q6HasEvaluativeExpression: AtomicJudgment;
  q7GivesCorrectAnswerDirectly: AtomicJudgment;
  q8HasPraiseExpression: AtomicJudgment;
  q8IsSpecific: AtomicJudgment;
  reflectsStudentWords: AtomicJudgment;
  addressesStudentDirectly: AtomicJudgment;
  reflectionAccurate: AtomicJudgment;
}

export interface ResponseJudgmentInput {
  id: number;
  precedingQuestionText: string | null;
  studentAnswerText: string;
  responseTexts: string[];
  nextQuestionText: string | null;
}

async function callLlm(batch: ResponseJudgmentInput[]): Promise<LlmResponseResult[]> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const systemPrompt = buildSystemPrompt();

  const input = { cases: batch };

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
                  reflectsStudentWords: judgmentSchema,
                  addressesStudentDirectly: judgmentSchema,
                  reflectionAccurate: judgmentSchema,
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
                  "reflectsStudentWords",
                  "addressesStudentDirectly",
                  "reflectionAccurate",
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

/** 실제 응답구간이 있는지(비어있으면 Q6/Q7/Q8 모두 구조적으로 성립 불가) 여부까지 반영해서
 *  최종 판정을 계산한다. checkResponseHandling과 5단계 개선안 재검증이 같은 공식을 쓴다. */
export function computeResponseGates(
  result: LlmResponseResult,
  hasResponseContent: boolean
): { q6: boolean; q7: boolean; q8: boolean } {
  const noFollowUp = !result.hasProbingInWindow.value && !result.nextQuestionIsFollowUp.value;

  return {
    q6: hasResponseContent && result.q6HasEvaluativeExpression.value && noFollowUp,
    q7:
      hasResponseContent &&
      result.studentAnswerWasWrong.value &&
      result.q7GivesCorrectAnswerDirectly.value &&
      noFollowUp,
    q8: hasResponseContent && result.q8HasPraiseExpression.value && !result.q8IsSpecific.value,
  };
}

/** 5단계 개선안 검증처럼, 실제 전사본 이벤트가 아니라 텍스트만으로 단건 판정할 때 쓴다. */
export async function judgeSingleResponse(
  input: Omit<ResponseJudgmentInput, "id">
): Promise<LlmResponseResult> {
  const results = await callLlm([{ id: 0, ...input }]);
  const result = results[0];
  if (!result) throw new Error("응답 구간 단건 판정 응답이 비어있습니다.");
  return result;
}

/** 6단계 L4(후속 발문 비율) 집계용 — 학생 답변마다 실제 반응이 있었는지와 그 반응에
 *  캐묻기(이유 묻기·되짚기·다른 학생 연결)가 있었는지를 그대로 노출한다. */
export interface ResponseProbingResult {
  studentSegmentIndex: number;
  hasResponseContent: boolean;
  hasProbingInWindow: boolean;
}

export async function checkResponseHandling(
  events: ResponseEvent[]
): Promise<{ findings: QuestioningFinding[]; probingResults: ResponseProbingResult[] }> {
  const targets = events.filter((e) => e.responseWindowSegments.length > 0 || e.nextQuestionSegment);
  if (targets.length === 0) return { findings: [], probingResults: [] };

  const inputs: Array<ResponseJudgmentInput & { event: ResponseEvent }> = targets.map((event) => ({
    id: event.studentSegment.index,
    precedingQuestionText: event.precedingQuestionSegment?.text ?? null,
    studentAnswerText: event.studentSegment.text,
    responseTexts: event.responseWindowSegments.map((s) => s.text),
    nextQuestionText: event.nextQuestionSegment?.text ?? null,
    event,
  }));

  const resultMap = await requestBatchInChunks(
    inputs,
    CHUNK_SIZE,
    async (batch) => callLlm(batch.map(({ event, ...rest }) => rest)),
    "응답 구간 판정"
  );

  const findings: QuestioningFinding[] = [];
  const probingResults: ResponseProbingResult[] = [];

  for (const input of inputs) {
    const result = resultMap.get(input.id);
    if (!result) continue;

    const event = input.event;
    const relevantSegments = [
      ...(event.precedingQuestionSegment ? [event.precedingQuestionSegment] : []),
      event.studentSegment,
      ...event.responseWindowSegments,
    ];

    const hasResponseContent = event.responseWindowSegments.length > 0;
    const gated = computeResponseGates(result, hasResponseContent);

    probingResults.push({
      studentSegmentIndex: event.studentSegment.index,
      hasResponseContent,
      hasProbingInWindow: result.hasProbingInWindow.value,
    });

    const reasons: Record<"Q6" | "Q7" | "Q8", string> = {
      Q6: `${result.q6HasEvaluativeExpression.reason} / ${result.hasProbingInWindow.reason} / ${result.nextQuestionIsFollowUp.reason}`,
      Q7: `${result.studentAnswerWasWrong.reason} / ${result.q7GivesCorrectAnswerDirectly.reason} / ${result.hasProbingInWindow.reason}`,
      Q8: `${result.q8HasPraiseExpression.reason} / ${result.q8IsSpecific.reason}`,
    };

    for (const id of RESPONSE_CRITERIA_IDS) {
      const gateKey = id.toLowerCase() as "q6" | "q7" | "q8";
      if (!gated[gateKey]) continue;
      const criterion = getCriterion(id);
      findings.push({
        criterionId: id,
        criterionName: criterion.name,
        severity: criterion.severity ?? "미지정",
        segments: relevantSegments,
        reason: reasons[id],
        detect: "llm",
        targetQuestionIndex: event.precedingQuestionSegment?.index ?? null,
        // 고쳐야 할 반응은 보통 응답 구간의 첫 발화(학생 답 직후 첫 반응)다.
        targetReactionSegmentIndex: event.responseWindowSegments[0]?.index ?? null,
      });
    }
  }

  return { findings, probingResults };
}
