import type { NormalizedTranscript } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import type { QuestionFindingsGroup } from "../types/suggestion.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchInChunks } from "../llm/batchWithRetry.js";
import { loadImprovementGuidelines } from "../criteria/loadImprovementGuidelines.js";

const CHUNK_SIZE = 3;

const SENTENCE_CRITERIA = new Set(["Q1", "Q2", "Q4", "Q9"]);

/**
 * Q3·Q5는 "정답이 정해진" 내용이라 LLM에 맡기지 않고 코드 템플릿으로만 만든다 —
 * Q5는 개선 행동·이유 둘 다(buildQ5Reason), Q3는 개선 행동(대기시간) + whatAndWhy
 * 설명(buildQ3Reason)까지 코드가 만든다. 그래서 LLM에게는 Q3·Q5용 actions/whatAndWhy
 * 항목을 애초에 요청하지 않는다(enum에서 제외해 구조적으로 막는다).
 */
const WHAT_WHY_CRITERIA_ENUM = ["Q1", "Q2", "Q4", "Q6", "Q7", "Q8", "Q9"] as const;
const ACTION_CRITERIA_ENUM = ["Q1", "Q2", "Q4", "Q6", "Q7", "Q8", "Q9"] as const;

export interface RawWhatWhy {
  criterionId: string;
  what: string;
  why: string;
  quotedOriginalText: string;
}

export interface RawAction {
  criterionId: string;
  action: string;
}

export interface RawSuggestionResult {
  id: number;
  revisedQuestionLine: string | null;
  hintQuestionLine: string | null;
  revisedResponseLine: string | null;
  /** 기준별 행동 문구. Q3·Q5는 절대 포함되지 않음(코드가 전담) — 코드가 한 번 더 걸러낸다. */
  actions: RawAction[];
  /** Q7이 있을 때만: 원래 교사가 알려준 정답 값. revisedResponseLine에 이 값이 있으면 실패. */
  q7AnswerValueToAvoid: string | null;
  /** Q3가 있을 때만: 자문자답으로 이미 말해버린 답 값. hintQuestionLine에 이 값이 있으면 실패. */
  q3AnswerValueToAvoid: string | null;
  /** Q8이 있을 때만: 칭찬·되짚기의 대상이 된 학생의 실제 말을 그대로 인용. 코드가 실존 여부를 검증. */
  praisedStudentQuote: string | null;
  /** 기준별 이유. Q3·Q5는 절대 포함되지 않음(코드가 전담) — 코드가 한 번 더 걸러낸다.
   *  나머지 대상 기준(병합된 것 포함)은 전부 있어야 하며, 빠지면 검증에 실패한다. */
  whatAndWhy: RawWhatWhy[];
}

export interface GenerationCase {
  group: QuestionFindingsGroup;
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

[중요 원칙] Q3·Q5는 정답이 정해진 내용이라 코드가 전담합니다 — 당신은 이 둘의
actions·whatAndWhy를 절대 만들지 않습니다(요청하지도 않으니 아예 신경 쓰지
마세요). Q3·Q5의 relatedSegmentTexts는 다른 필드(q3AnswerValueToAvoid,
hintQuestionLine 등)를 위한 참고 정보로만 쓰세요.

[톤] ${g.tone}
[길이] ${Object.entries(g.length).map(([k, v]) => `${k}: ${v}`).join(" / ")}
[피할 것]
${g.what_to_avoid.map((s) => `- ${s}`).join("\n")}

[기준별 방향]
${perCriterionText}

[출력 필드 구분 — 엄격하게 지키세요]
- revisedQuestionLine: Q1·Q2·Q4·Q9 중 하나라도 있을 때만(mustRewriteQuestion=true) 채우고,
  그 외에는 반드시 null입니다. Q3만 있다고 여기 채우지 마세요. nextContext(바로 다음
  학생 발화)에 나오는 결론·숫자·정답을 이 발문 안에 미리 넣지 마세요 — 학생이 아직
  말하지 않은 답을 발문 문장 안에 넣으면 안 됩니다. 학생이 스스로 생각해서 답할 여지를
  남기는 질문으로 쓰세요.
- hintQuestionLine: hasQ3=true이면 반드시(필수) 채우세요 — "학생 반응이 없을 때 쓸
  힌트 발문"입니다. null이면 검증 실패입니다. 원래 발문을 말만 바꿔 다시 묻는 것이면
  안 됩니다(핵심 내용이 같으면 실패로 처리됩니다) — 대신 구체물을 보여주거나, 더 쉬운
  숫자로 비교해보게 하거나, 그림을 그려보게 하는 등 "생각할 실마리"를 주는 새로운
  접근이어야 합니다. 이미 자문자답으로 말해버린 답(q3AnswerValueToAvoid)을 절대 다시
  포함하면 안 됩니다 — 힌트는 정답을 주지 않습니다. hasQ3=false면 반드시 null입니다.
- revisedResponseLine: hasQ6·hasQ7·hasQ8 중 하나라도 true일 때는 반드시(필수) 값을
  채우세요 — null이면 검증 실패입니다. 셋 다 false면 반드시 null입니다. 이 필드는
  교사가 학생에게 실제로 하는 말(대사)입니다 — "~해 주세요", "~해 보세요", "~하면
  좋겠어요"처럼 교사 자신에게 지시하는 문장을 쓰면 안 됩니다. 특히 Q8이 있으면 아래
  둘 중 하나를 실제로 담아야 합니다: (a) 학생이 무엇을 잘했는지 교사가 직접 구체적으로
  말하는 칭찬 문장(예: "배수를 나란히 써서 비교한 방법이 좋았어요") — 이 경우
  praisedStudentQuote를 채우세요. 또는 (b) 칭찬 표현 없이도 학생이 한 말을 교사가
  구체적으로 되짚는 문장(예: "4씩 커진다고 했구나") — 이 경우 praisedStudentQuote는
  null로 둬도 됩니다. 학생에게 "무엇이 좋았는지 말해 줄래요?"처럼 되묻는 문장은 둘 다
  아니므로 실패합니다.
- actions: 기준별 행동 문구 배열입니다. { criterionId, action } 형태로, Q3·Q5를 뺀
  나머지 기준 중 대사가 아닌 행동 지침이 필요한 경우에만 넣으세요(예: Q9의 "전체
  질문 후 지명하기"). 필요 없는 기준은 배열에 넣지 마세요(빈 배열도 가능). 이 기준
  중 대기시간(초) 관련 문구는 절대 쓰지 마세요 — 그건 항상 코드가 담당합니다.
- q3AnswerValueToAvoid: hasQ3=true일 때만 채우세요. 자문자답 발화(findings의 Q3
  relatedSegmentTexts 중 교사가 스스로 답한 부분)에서 교사가 이미 말해버린 답 값을
  짧게 그대로 뽑으세요(예: "3분의 1"). hasQ3=false면 반드시 null입니다.
- praisedStudentQuote: hasQ8=true이고 (a) 구체적 칭찬 방식을 썼을 때만 채우세요.
  revisedResponseLine에서 칭찬 대상이 된, 학생이 실제로 한 말을 findings의
  relatedSegmentTexts 중 학생 발화에서 그대로(원문 그대로의 글자로) 인용하세요 —
  코드가 실제 학생 발화에 있는지 검증합니다. (b) 되짚기 방식을 썼거나 hasQ8=false면
  null로 둡니다.

[Q1 처리 방법] revisedQuestionLine에는 겹질문 중 첫 번째로 물을 질문 하나만 담으세요.
나머지 질문은 지우는 게 아니라 "학생이 답한 뒤에 잇는" 것입니다. whatAndWhy의 Q1
항목 what에만 "먼저 [1번 질문]을 묻고, 학생이 답하면 [2번 질문]을 이어서 묻기" 형식의
순서를 쓰세요. 다른 기준(Q4·Q7 등)에서 "먼저 이유를 물어보기"처럼 정당한 이유로
"먼저"를 쓰는 것은 괜찮습니다 — 그 기준 자체의 조언이면 됩니다.

findings 중 note가 있는 항목(Q3 자문자답의 답변 발화에 걸린 Q4)도 whatAndWhy에
반드시 자기 항목을 만드세요 — note는 "이 기준이 원래 발문이 아니라 자문자답
발화 자체에 대한 것"이라는 맥락만 알려주는 것이고, 설명 자체는 그 기준 고유의
문제(예: Q4라면 왜 그 자문자답 발화가 유도 발문 형태이기도 한지)에 집중하면
됩니다. 다만 이런 note 있는 기준은 actions나 revisedQuestionLine을 별도로
만들지 마세요(그 발화 자체를 하지 않는 것, 즉 Q3의 개선으로 이미 해소됩니다).

whatAndWhy는 대상 기준(Q3·Q5 제외) 전부 하나씩 빠짐없이 작성하세요 — 하나라도
빠지면 검증에 실패합니다. quotedOriginalText에는
원래 발화(originalQuestionText 또는 findings의 relatedSegmentTexts)에 실제로 있는
문구를 정확히 그대로(축약·의역하지 말고 원문 그대로의 글자로) 인용하세요 — 이 인용구는
코드가 원문에 실제로 있는지 검증합니다. 그 발화를 "설명하는 문장"을 만들어서 넣으면
안 됩니다. 예: findings에 '딩동댕~'이라는 평가 표현이 있다"는 reason이 있어도,
quotedOriginalText에는 그 reason 문장이 아니라 실제 발화 조각인 "딩동댕~"만
넣으세요("'딩동댕~'이라는 평가 표현이 있다."처럼 reason을 그대로 베끼면 실패합니다).
why는 일반론이 아니라 이 수업 내용(원래 발문, 학생 답, 성취기준)에 근거해서
설명하세요.

regenerationFeedback이 있으면, 이전 시도가 왜 실패했는지 알려주는 것이니 그 문제를
피해서 다시 만드세요.

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
    cases: batch.map(({ group, regenerationFeedback }) => {
      const idx = group.question.segment.index;
      const rewriteCriteriaIds = group.findings
        .filter((f) => !f.mergeNote)
        .map((f) => f.criterionId);

      return {
        id: idx,
        originalQuestionText: group.question.segment.text,
        questionType: group.question.questionType,
        prevContext: transcript.segments[idx - 1]?.text ?? null,
        nextContext: transcript.segments[idx + 1]?.text ?? null,
        grade: transcript.meta.grade,
        standardCode: conceptMatch.standardCode,
        standardSummary: conceptMatch.standardSummary,
        findings: group.findings
          .filter((f) => f.criterionId !== "Q5")
          .map((f) => ({
            criterionId: f.criterionId,
            criterionName: f.criterionName,
            reason: f.reason,
            severity: f.severity,
            relatedSegmentTexts: f.segments.map((s) => s.text),
            note: f.mergeNote ?? null,
          })),
        mustRewriteQuestion: rewriteCriteriaIds.some((id) => SENTENCE_CRITERIA.has(id)),
        hasQ3: group.findings.some((f) => f.criterionId === "Q3"),
        hasQ6: group.findings.some((f) => f.criterionId === "Q6" && !f.mergeNote),
        hasQ7: group.findings.some((f) => f.criterionId === "Q7" && !f.mergeNote),
        hasQ8: group.findings.some((f) => f.criterionId === "Q8" && !f.mergeNote),
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
                  revisedQuestionLine: { type: ["string", "null"] },
                  hintQuestionLine: { type: ["string", "null"] },
                  revisedResponseLine: { type: ["string", "null"] },
                  actions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterionId: { type: "string", enum: [...ACTION_CRITERIA_ENUM] },
                        action: { type: "string" },
                      },
                      required: ["criterionId", "action"],
                      additionalProperties: false,
                    },
                  },
                  q7AnswerValueToAvoid: { type: ["string", "null"] },
                  q3AnswerValueToAvoid: { type: ["string", "null"] },
                  praisedStudentQuote: { type: ["string", "null"] },
                  whatAndWhy: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterionId: { type: "string", enum: [...WHAT_WHY_CRITERIA_ENUM] },
                        what: { type: "string" },
                        why: { type: "string" },
                        quotedOriginalText: { type: "string" },
                      },
                      required: ["criterionId", "what", "why", "quotedOriginalText"],
                      additionalProperties: false,
                    },
                  },
                },
                required: [
                  "id",
                  "revisedQuestionLine",
                  "hintQuestionLine",
                  "revisedResponseLine",
                  "actions",
                  "q7AnswerValueToAvoid",
                  "q3AnswerValueToAvoid",
                  "praisedStudentQuote",
                  "whatAndWhy",
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
