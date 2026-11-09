import type { QuestionCandidate, ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";
import { requestBatchInChunks } from "../llm/batchWithRetry.js";
import {
  getCriterion,
  getClassificationRepeats,
  getQuestionTypes,
  getRepresentativePhrases,
  loadQuestioningCriteria,
} from "../criteria/loadQuestioningCriteria.js";
import { buildQ1Reason, buildQ2Reason, buildQ4Reason, buildQ9Reason } from "../report/findingReason.js";

/** 사례당 필드가 많고 프롬프트가 길어서(유형 판단 원칙·대비 예시 포함) 한 번에 너무 많이
 *  넣으면 LLM 품질이 떨어지는 게 관찰되어 묶음을 작게 유지한다. */
const CHUNK_SIZE = 3;

const QUESTION_LEVEL_CRITERIA_IDS = ["Q1", "Q2", "Q9"] as const;
type QuestionLevelCriterionId = (typeof QUESTION_LEVEL_CRITERIA_IDS)[number];

function stripTrailingPunct(s: string): string {
  return s.replace(/[!?.]+$/u, "").trim();
}

/**
 * Q4의 "확인형 어미" 구조 검사(코드 쪽). criteria 파일의 representative_phrases(예: '~죠?',
 * '그렇지?', '맞죠?', '그치?')로 끝나는지 확인한다. 이 목록에 없는 확인형 어미는 LLM의
 * q4EndsWithConfirmationTone 판단으로 보완한다(코드 목록 OR LLM 판단). Q4는 이 구조
 * 조건과 LLM의 의미 판단(답이 이미 들어있는가) 둘 다 만족해야 최종 성립한다 — "~죠?"로
 * 끝나도 답이 안 들어있으면(예: "3의 배수에는 뭐가 있었죠?") Q4가 아니다.
 */
function endsWithConfirmationEnding(text: string, patterns: string[]): boolean {
  const trimmed = stripTrailingPunct(text);
  return patterns.some((p) => trimmed.endsWith(stripTrailingPunct(p.replace(/^~/, ""))));
}

function buildSystemPrompt(questionTypes: string[]): string {
  const file = loadQuestioningCriteria();
  const typeDescriptions = Object.entries(file.question_type_scheme.types)
    .map(([label, desc]) => `- "${label}": ${desc}`)
    .join("\n");

  const criteriaText = QUESTION_LEVEL_CRITERIA_IDS.map((id) => {
    const c = getCriterion(id);
    const parts = [`- ${id} (${c.name}): ${c.description}`];
    if (c.judge_rule) parts.push(`  판단 규칙: ${c.judge_rule}`);
    if (c.hint_for_code) parts.push(`  참고: ${c.hint_for_code}`);
    if (c.note) parts.push(`  주의: ${c.note}`);
    return parts.join("\n");
  }).join("\n");

  const q4 = getCriterion("Q4");

  const contrastText = (file.question_type_scheme.contrast_examples ?? [])
    .map((group) => {
      const cases = group.cases
        .map((c) => `    - "${c.text}" → ${c.type} (${c.why})`)
        .join("\n");
      return `  같은 어미 "${group.shared_ending}":\n${cases}`;
    })
    .join("\n");

  return `당신은 초등 수학 수업의 교사 발화 후보 목록을 검토하는 전문가입니다.
각 후보는 물음표나 의문형 어미로 끝나서 "발문일 가능성이 있다"고 코드가 골라낸 것입니다.
실제로 발문이 아닌 경우(예: 의문형 어미지만 질문이 아닌 서술)도 있으니, isQuestion으로 먼저 판단하세요.

[입력에 text와, 가끔 turnText가 있습니다] text는 판정 대상 문장 그 자체입니다. 일부
candidate에만 turnText가 추가로 있는데, 그 문장이 들어있는 교사의 전체 발화(턴) 텍스트가
text보다 더 긴 경우입니다(앞에 다른 문장이 붙어 있거나, STT가 한 호흡을 여러 세그먼트로
쪼갠 걸 다시 합친 것) — turnText가 없는 candidate는 text 자체가 곧 턴 전체이므로 신경 쓸
필요 없습니다. isQuestion·questionType·q2_vague·q4AnswerAlreadyGiven·q4ExpectsYesNoOnly·
q4EndsWithConfirmationTone은 **text**만 보고 판단하세요. q1_compound(겹질문 — 턴 전체에
서로 다른 질문이 2개 이상 있는가)와 q9_named_first(이름 먼저 부르고 질문 — 턴 안에서
이름을 부른 뒤 질문했는가)만 turnText가 있으면 **turnText**를, 없으면 text를 보고
판단하세요.

[isQuestion 판정 시 기본 규칙] 물음표(?)가 문장 안에 있으면 거의 항상 isQuestion=true입니다.
문장 앞부분에 다른 정의·설명·되짚기가 먼저 나오고 그 뒤에 물음표로 끝나는 질문이 이어져도
(예: "이걸 최소공배수라고 해요. 그럼 6과 8의 최소공배수는 뭘까요?") 물음표가 있는 질문
부분이 실제 답을 요구하므로 반드시 isQuestion=true입니다. 앞부분의 설명 때문에 "질문이
아니다"라고 판단하지 마세요.

[isQuestion 판정 시 주의] 물음표가 없어도 발문일 수 있습니다. "말해 볼 사람", "해 볼까",
"~할 사람 있어요"처럼 자원자를 부르거나 답을 요구하는 초대형 표현은 물음표가 없어도
isQuestion=true입니다. 존댓말 어미("요")가 빠진 구어체("~할까", "~일까", "뭐라고 할까")도
학생에게 답을 요구하면 isQuestion=true입니다. 예: "그럼 4의 배수도 말해 볼 사람"과
"3의 배수와 4의 배수에 둘 다 있는 수를 뭐라고 할까"는 둘 다 물음표가 없지만 명백히
답을 요구하는 발문입니다.

[발문 유형 분류 (${file.question_type_scheme.name})]
${typeDescriptions}
${file.question_type_scheme.note}

[유형 판단 원칙] ${file.question_type_scheme.judging_principle ?? ""}
말투(어미)만 보고 유형을 정하지 마세요 — 학생이 실제로 머릿속에서 무엇을 해야 하는지가
기준입니다. 같은 어미라도 유형이 다를 수 있는 예:
${contrastText}

isQuestion이 false이면 questionType은 그래도 가장 가까운 유형으로 채우되, 이후 결과에서는 제외됩니다.

[발문 단위로 같이 판정할 기준]
${criteriaText}

[Q4 유도 발문 관련 — 최종 판정은 코드가 계산하니, 당신은 아래 두 가지만 독립적으로 답하세요]
${q4.id} (${q4.name}): ${q4.description}
발화 안에 질문 문장이 여러 개 있으면 "마지막"(가장 실질적인) 질문 문장만 보고 판단하세요.

- q4AnswerAlreadyGiven: 그 질문이 정답/기대하는 답을 문장 안에 이미 담고 있는가?
  예: "3분의 1이죠?"는 답(3분의 1)을 이미 말했으므로 true. "가장 작은 공배수는 12잖아,
  그치?"도 답(12)을 이미 제시했으므로 true. "3의 배수에는 뭐가 있었죠?"는 답을 전혀
  주지 않고 학생이 직접 떠올려야 하므로 false.

- q4ExpectsYesNoOnly: 그 질문이 학생에게 "네/아니요"(또는 동의 여부)만 요구하는가?
  ("그렇지?", "맞죠?", "그치?"처럼) 학생이 새로운 정보(숫자·설명·계산 결과 등)를 직접
  말해야 하면 false입니다.

- q4EndsWithConfirmationTone: 그 질문 문장이 확인형 어미(동의를 구하는 말투)로 끝나는가?
  "~죠?", "그렇지?", "맞죠?", "그치?", "~지?", "~잖아?", "맞아?", "그렇죠?", "알겠죠?",
  "~이지?", "~거든?"처럼 상대의 동의·확인을 구하는 말투면 true입니다. 이 목록에 없는
  표현이라도 같은 말투(동의를 구하는 어조)면 true로 판단하세요. "~까요?", "~ㄹ까요?",
  "~니?"처럼 정말 몰라서 묻는 열린 질문 어미는 false입니다.

이 값들과는 별개로, 이런 발화가 동시에 Q3(자문자답 후보)로도 분류되는 경우가 있는데,
Q3 여부는 이 판단에 영향을 주지 않습니다.

각 판정 항목(q1_compound, q2_vague, q9_named_first, q4AnswerAlreadyGiven,
q4ExpectsYesNoOnly, q4EndsWithConfirmationTone)은 {value 또는 flag: boolean, reason:
한국어 1문장}으로 답하세요. id는 입력값을 그대로 유지하세요.`;
}

interface LlmFlag {
  flag: boolean;
  reason: string;
}

interface AtomicJudgment {
  value: boolean;
  reason: string;
}

interface LlmQuestionResult {
  id: number;
  isQuestion: boolean;
  questionType: string;
  q1_compound: LlmFlag;
  q2_vague: LlmFlag;
  q9_named_first: LlmFlag;
  q4AnswerAlreadyGiven: AtomicJudgment;
  q4ExpectsYesNoOnly: AtomicJudgment;
  q4EndsWithConfirmationTone: AtomicJudgment;
}

/** classifyWithMajorityVote가 매기는 호출 전용 임시 id — candidate.segment.index는
 *  한 세그먼트에 문장이 여러 개면 candidate끼리 겹칠 수 있어서 쓸 수 없다. */
interface CandidateItem {
  id: number;
  candidate: QuestionCandidate;
}

async function callLlm(batch: CandidateItem[], questionTypes: string[]): Promise<LlmQuestionResult[]> {
  const client = getOpenAIClient();
  const model = getAnalysisModel();
  const systemPrompt = buildSystemPrompt(questionTypes);

  const input = {
    candidates: batch.map(({ id, candidate }) => {
      const base = { id, text: candidate.text, questionMarkCount: candidate.questionMarkCount };
      const turnText = candidate.turnSegments.map((s) => s.text).join(" ");
      // turnText가 text와 같으면(턴이 한 문장뿐이면) 아예 빼서 "똑같은 필드가 왜 두 개"
      // 같은 혼란을 줄인다 — 이 필드가 없는 candidate는 text와 turnText가 같다는 뜻.
      return turnText === candidate.text ? base : { ...base, turnText };
    }),
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
        name: "question_classification",
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
                  isQuestion: { type: "boolean" },
                  questionType: { type: "string", enum: questionTypes },
                  q1_compound: flagSchema,
                  q2_vague: flagSchema,
                  q9_named_first: flagSchema,
                  q4AnswerAlreadyGiven: judgmentSchema,
                  q4ExpectsYesNoOnly: judgmentSchema,
                  q4EndsWithConfirmationTone: judgmentSchema,
                },
                required: [
                  "id",
                  "isQuestion",
                  "questionType",
                  "q1_compound",
                  "q2_vague",
                  "q9_named_first",
                  "q4AnswerAlreadyGiven",
                  "q4ExpectsYesNoOnly",
                  "q4EndsWithConfirmationTone",
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
  if (!content) throw new Error("발문 분류 응답이 비어있습니다.");
  const parsed = JSON.parse(content) as { results: LlmQuestionResult[] };
  return parsed.results;
}

function majorityBoolean(values: boolean[]): boolean {
  const trueCount = values.filter(Boolean).length;
  return trueCount * 2 > values.length;
}

function majorityString(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** 다수결로 정해진 flag/value와 같은 판정을 낸 패스 중 첫 번째의 reason을 고른다. */
function pickReasonFor<T extends { reason: string }>(
  passResults: T[],
  getFlag: (r: T) => boolean,
  majority: boolean
): string {
  const match = passResults.find((r) => getFlag(r) === majority);
  return match?.reason ?? passResults[0].reason;
}

/**
 * repeats회(3 이상 홀수 권장) 독립적으로 전체 분류를 반복 호출하고, 후보별로 각
 * 판정 항목을 다수결로 합친다. repeats=1이면 그냥 1회 호출 결과를 그대로 쓴다
 * (기존 동작과 동일, 비용도 그대로).
 */
async function classifyWithMajorityVote(
  candidates: QuestionCandidate[],
  questionTypes: string[],
  repeats: number
): Promise<Map<number, LlmQuestionResult>> {
  const items: CandidateItem[] = candidates.map((candidate, id) => ({ id, candidate }));

  const runOnePass = () => requestBatchInChunks(items, CHUNK_SIZE, (batch) => callLlm(batch, questionTypes), "발문 분류");

  if (repeats <= 1) return runOnePass();

  const passes = await Promise.all(Array.from({ length: repeats }, () => runOnePass()));

  const merged = new Map<number, LlmQuestionResult>();
  for (const item of items) {
    const id = item.id;
    const perPass = passes.map((p) => p.get(id)).filter((r): r is LlmQuestionResult => r !== undefined);
    if (perPass.length === 0) continue;

    const isQuestion = majorityBoolean(perPass.map((r) => r.isQuestion));
    const questionType = majorityString(perPass.map((r) => r.questionType));

    function mergeFlag(get: (r: LlmQuestionResult) => { flag: boolean; reason: string }) {
      const flag = majorityBoolean(perPass.map((r) => get(r).flag));
      const reason = pickReasonFor(perPass.map(get), (r) => r.flag, flag);
      return { flag, reason };
    }
    function mergeJudgment(get: (r: LlmQuestionResult) => { value: boolean; reason: string }) {
      const value = majorityBoolean(perPass.map((r) => get(r).value));
      const reason = pickReasonFor(perPass.map(get), (r) => r.value, value);
      return { value, reason };
    }

    merged.set(id, {
      id,
      isQuestion,
      questionType,
      q1_compound: mergeFlag((r) => r.q1_compound),
      q2_vague: mergeFlag((r) => r.q2_vague),
      q9_named_first: mergeFlag((r) => r.q9_named_first),
      q4AnswerAlreadyGiven: mergeJudgment((r) => r.q4AnswerAlreadyGiven),
      q4ExpectsYesNoOnly: mergeJudgment((r) => r.q4ExpectsYesNoOnly),
      q4EndsWithConfirmationTone: mergeJudgment((r) => r.q4EndsWithConfirmationTone),
    });
  }

  return merged;
}

export async function classifyAndCheckQuestions(
  candidates: QuestionCandidate[]
): Promise<{ questions: ClassifiedQuestion[]; findings: QuestioningFinding[] }> {
  if (candidates.length === 0) return { questions: [], findings: [] };

  const questionTypes = getQuestionTypes();
  const q4Patterns = getRepresentativePhrases("Q4");
  const repeats = getClassificationRepeats();

  const resultMap = await classifyWithMajorityVote(candidates, questionTypes, repeats);

  const questions: ClassifiedQuestion[] = [];
  const findings: QuestioningFinding[] = [];

  const criterionMeta: Record<
    QuestionLevelCriterionId,
    { key: keyof LlmQuestionResult; buildReason: (questionText: string) => string }
  > = {
    Q1: { key: "q1_compound", buildReason: buildQ1Reason },
    Q2: { key: "q2_vague", buildReason: buildQ2Reason },
    Q9: { key: "q9_named_first", buildReason: buildQ9Reason },
  };

  // "turn" 단위 기준(Q1·Q9)은 같은 턴에서 문장마다 반복 판정되므로, 턴당 지적 1건으로
  // 줄인다 — criteria 파일의 analysis_unit을 코드가 읽어서 판단한다(하드코딩 안 함).
  const seenTurnFindings = new Set<string>();

  for (const [localId, candidate] of candidates.entries()) {
    const result = resultMap.get(localId);
    if (!result) continue; // 재시도 후에도 누락된 경우

    if (!result.isQuestion) continue; // 발문이 아니면 제외

    questions.push({
      segment: candidate.segment,
      questionType: result.questionType,
      questionMarkCount: candidate.questionMarkCount,
    });

    for (const id of QUESTION_LEVEL_CRITERIA_IDS) {
      const meta = criterionMeta[id];
      const flag = result[meta.key] as LlmFlag;
      if (!flag.flag) continue;
      const criterion = getCriterion(id);

      if (criterion.analysis_unit === "turn") {
        const turnKey = candidate.turnSegments[0].index;
        const dedupKey = `${id}:${turnKey}`;
        if (seenTurnFindings.has(dedupKey)) continue;
        seenTurnFindings.add(dedupKey);

        findings.push({
          criterionId: id,
          criterionName: criterion.name,
          severity: criterion.severity ?? "미지정",
          segments: candidate.turnSegments,
          reason: meta.buildReason(candidate.turnSegments.map((s) => s.text).join(" ")),
          devReason: flag.reason,
          detect: "llm",
          targetQuestionIndex: turnKey,
        });
      } else {
        findings.push({
          criterionId: id,
          criterionName: criterion.name,
          severity: criterion.severity ?? "미지정",
          segments: [candidate.segment],
          reason: meta.buildReason(candidate.text),
          devReason: flag.reason,
          detect: "llm",
          targetQuestionIndex: candidate.segment.index,
        });
      }
    }

    // Q4: 의미 판단은 "답이 이미 들어있다"와 "예/아니오만 요구한다" 둘 다 참이어야 한다
    // (둘 중 하나만 참이면 Q4가 아니다 — 예: "동의해요?"는 예/아니오만 요구하지만 답을
    // 주지 않는 열린 질문이라 Q4가 아니다). 여기에 구조적으로 확인형 어미로 끝날 때만
    // 최종 성립한다. "~죠?"로 끝나도 답이 안 들어있으면(예: "3의 배수에는 뭐가
    // 있었죠?") Q4가 아니다.
    // 구조 조건은 criteria 파일의 대표 표현 목록과 정확히 일치하지 않는 확인형 어미도
    // 놓치지 않도록, 코드의 목록 일치와 LLM의 어조 판단 중 하나만 참이어도 만족시킨다.
    const semanticSignal = result.q4AnswerAlreadyGiven.value && result.q4ExpectsYesNoOnly.value;
    const structuralSignal =
      endsWithConfirmationEnding(candidate.text, q4Patterns) || result.q4EndsWithConfirmationTone.value;
    if (semanticSignal && structuralSignal) {
      const criterion = getCriterion("Q4");
      findings.push({
        criterionId: "Q4",
        criterionName: criterion.name,
        severity: criterion.severity ?? "미지정",
        segments: [candidate.segment],
        reason: buildQ4Reason(candidate.text),
        devReason: `${result.q4AnswerAlreadyGiven.reason} / ${result.q4ExpectsYesNoOnly.reason} / ${result.q4EndsWithConfirmationTone.reason}`,
        detect: "llm",
        targetQuestionIndex: candidate.segment.index,
      });
    }
  }

  return { questions, findings };
}
