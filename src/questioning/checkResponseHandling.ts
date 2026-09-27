import type { ResponseEvent, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchWithRetry } from "../llm/batchWithRetry.js";
import { getCriterion } from "../criteria/loadQuestioningCriteria.js";

const RESPONSE_CRITERIA_IDS = ["Q6", "Q7", "Q8"] as const;

/** criteria 파일의 description에 예시로 '...'로 인용된 표현을 키워드로 뽑아온다.
 *  (Q6: '맞아요', '정답!' 등 / Q8: '잘했어요' 등 — 코드에 별도 단어를 하드코딩하지 않기 위함) */
function extractQuotedExamples(text: string): string[] {
  return Array.from(text.matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[!?.]+$/u, "");
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(stripTrailingPunct(k)));
}

function buildSystemPrompt(): string {
  const q6 = getCriterion("Q6");
  const q7 = getCriterion("Q7");
  const q8 = getCriterion("Q8");

  return `당신은 초등 수학 수업에서 학생 답변에 대한 교사의 반응을 검토하는 전문가입니다.
각 사례는 (교사의 직전 발문, 학생 답변, 그 뒤 이어지는 교사 응답 구간, 참고용 다음 발문,
q6KeywordFound, q8KeywordFound)로 구성됩니다. 응답 구간은 "학생 답 직후부터 다음 교사
발문 직전까지"만 포함하고, 다음 발문 자체는 별도로 줍니다.

q6KeywordFound/q8KeywordFound는 코드가 응답 구간 텍스트에서 정답판정/칭찬 표현을 미리
찾아본 결과입니다. false이면 해당 기준은 절대 flag=true로 하지 마세요.
true이면, 아래 예외 규칙만 판단해서 flag를 정하세요.

먼저 studentAnswerWasWrong(학생 답이 수학적으로 틀렸는지)을 판단하세요. 애매하면 false로
두세요. 직전 발문이 겹질문(하위 질문이 여러 개)이고 학생이 그중 하나에는 올바르게
답했다면, 나머지 하위 질문에 답하지 않았다는 이유만으로 틀렸다고 판단하지 마세요
(studentAnswerWasWrong=false). 학생이 실제로 말한 내용이 수학적으로 잘못된 경우에만
true로 하세요.

다음 발문(nextQuestionText)이 있다면 nextQuestionIsFollowUp을 판단하세요. 없으면 false로
두세요. 엄격한 기준을 쓰세요:
- 캐묻기(true)의 조건: 방금 나온 그 답 자체를 다시 다룹니다 — "왜 그렇게 생각했어요?",
  "정말요?", "다른 친구들은 어떻게 생각해요?"처럼 같은 답에 대한 이유·근거·동의여부를 묻습니다.
- 새 주제(false)의 조건: 새로운 숫자·새로운 대상·새로운 상황을 제시합니다(예: 다른 조각 수,
  다른 분수, 다음 문제). 수업의 같은 큰 주제(예: 분수)를 계속 다루더라도, 방금 답한 그 문제가
  아니라 다른 문제로 넘어가면 새 주제입니다.
단순히 "수업이 자연스럽게 이어진다"는 이유로 true로 판단하지 마세요 — 방금 답을 다시
검증/캐묻는지만 보세요.

[${q6.id} ${q6.name}] ${q6.description}
판단 규칙: ${q6.judge_rule}
q6KeywordFound=true일 때만 판단합니다. 다음 공식을 그대로 적용하세요:
flag = (응답 구간에 이유 묻기·되짚기·다른 학생 연결이 전혀 없다) AND (nextQuestionIsFollowUp이 false다)
즉 예외(이유 묻기/되짚기/다른 학생 연결 있음, 또는 캐묻기로 이어짐)가 하나도 없으면
반드시 flag=true입니다. 학생 답이 맞았는지 틀렸는지는 이 판단과 무관합니다 — Q6은
정답/오답 여부와 상관없이, 그 뒤에 캐묻는 행동이 있었는지만 봅니다.
예시: 학생 답이 맞고, 교사가 "맞아요. 잘했어요."라고만 한 뒤 완전히 새로운 질문(새 숫자)으로
넘어감 → 예외 없음 → flag=true. ("정답이니까 괜찮다"고 판단하지 마세요.)

[${q7.id} ${q7.name}] ${q7.description}
다음 조건을 모두 만족해야만 flag=true입니다 (하나라도 안 맞으면 flag=false):
1. studentAnswerWasWrong=true.
2. responseTexts 안에 교사가 정답을 직접 알려주는 문장이 실제로 있다. responseTexts가
   비어있으면(다음 발화가 바로 다음 발문이라 응답 구간이 없으면) 정답을 알려준 문장 자체가
   없으므로 무조건 flag=false입니다.
3. responseTexts와 nextQuestionText 어디에도 "왜", "이유", "설명해" 같은 이유를 묻는
   표현이 없다. nextQuestionText가 "왜 그렇게 생각했어요?"처럼 이유를 묻는 캐묻기라면,
   그것이 바로 올바른 대응이므로 flag=false입니다.

[${q8.id} ${q8.name}] ${q8.description}
판단 규칙: ${q8.judge_rule}
q8KeywordFound=true일 때만: 무엇이 좋았는지 구체적 설명이 같이 있으면 flag=false,
그냥 칭찬만 있으면 flag=true.

Q6과 Q8은 독립적으로 판단하세요 — 한 발화에 둘 다 있으면(예: "맞아요. 잘했어요.") 둘 다
flag=true일 수 있습니다.

id는 입력값을 그대로 유지하세요.`;
}

interface LlmFlag {
  flag: boolean;
  reason: string;
}

interface LlmResponseResult {
  id: number;
  studentAnswerWasWrong: boolean;
  nextQuestionIsFollowUp: boolean;
  q6: LlmFlag;
  q7: LlmFlag;
  q8: LlmFlag;
}

interface ResponseCase {
  event: ResponseEvent;
  q6KeywordFound: boolean;
  q8KeywordFound: boolean;
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
      q6KeywordFound: c.q6KeywordFound,
      q8KeywordFound: c.q8KeywordFound,
    })),
  };

  const flagSchema = {
    type: "object" as const,
    properties: {
      flag: { type: "boolean" as const },
      reason: { type: "string" as const },
    },
    required: ["flag", "reason"],
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
                  studentAnswerWasWrong: { type: "boolean" },
                  nextQuestionIsFollowUp: { type: "boolean" },
                  q6: flagSchema,
                  q7: flagSchema,
                  q8: flagSchema,
                },
                required: ["id", "studentAnswerWasWrong", "nextQuestionIsFollowUp", "q6", "q7", "q8"],
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

  const q6Keywords = extractQuotedExamples(getCriterion("Q6").description);
  const q8Keywords = extractQuotedExamples(getCriterion("Q8").description);

  const cases: ResponseCase[] = targets.map((event) => {
    const windowText = event.responseWindowSegments.map((s) => s.text).join(" ");
    return {
      event,
      q6KeywordFound: containsAnyKeyword(windowText, q6Keywords),
      q8KeywordFound: containsAnyKeyword(windowText, q8Keywords),
    };
  });

  const resultMap = await requestBatchWithRetry(
    cases.map((c) => ({ id: c.event.studentSegment.index, case: c })),
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

    // 코드가 찾은 키워드가 없으면 LLM 판단과 무관하게 무조건 false로 강제한다 (환각 방지)
    const gated = {
      Q6: c.q6KeywordFound && result.q6.flag,
      // 학생 답이 틀렸다고 판단하지 않았거나, 응답 구간이 비어있으면(교사가 정답을
      // 알려준 문장 자체가 없으면) "오답 즉시 교정"은 성립할 수 없다
      Q7: result.studentAnswerWasWrong && c.event.responseWindowSegments.length > 0 && result.q7.flag,
      Q8: c.q8KeywordFound && result.q8.flag,
    };

    for (const id of RESPONSE_CRITERIA_IDS) {
      if (!gated[id]) continue;
      const flag = result[id.toLowerCase() as "q6" | "q7" | "q8"];
      const criterion = getCriterion(id);
      findings.push({
        criterionId: id,
        criterionName: criterion.name,
        severity: criterion.severity ?? "미지정",
        segments: relevantSegments,
        reason: flag.reason,
        detect: "llm",
      });
    }
  }

  return findings;
}
