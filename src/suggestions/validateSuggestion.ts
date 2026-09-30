import type { NormalizedTranscript } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import type { QuestionCandidate } from "../types/questioning.js";
import type { QuestionFindingsGroup } from "../types/suggestion.js";
import type { RawSuggestionResult } from "./generateSuggestion.js";
import { classifyAndCheckQuestions } from "../questioning/classifyAndCheckQuestions.js";
import { judgeSingleResponse } from "../questioning/checkResponseHandling.js";
import { detectKnownTermsInText } from "../vocab/detectKnownTerms.js";
import { getAnalysisModel, getOpenAIClient } from "../llm/client.js";

const SENTENCE_CRITERIA = new Set(["Q1", "Q2", "Q4", "Q9"]);
/** Q1 전용 "먼저 ~를 묻고 / 이어서 묻기" 순서 설명 패턴. Q5 항목에만 적용한다(사용자 결정 —
 *  Q4·Q7 등에서 "먼저 이유를 묻기"는 정당한 조언이라 오탐이었다). Q5는 코드 템플릿만
 *  쓰므로 이 검사는 실질적으로 항상 통과하지만, 혹시 모를 회귀를 잡는 안전망으로 남긴다. */
const Q1_SEQUENCING_PATTERN = /먼저.*(묻|물으)|이어서\s*묻/;
/** Q3·Q5 대기시간 지시 패턴. actions의 어떤 항목에도 이게 있으면 안 된다 — 대기시간
 *  문구는 항상 코드가 붙인다. */
const WAIT_ACTION_PATTERN = /\d+(\.\d+)?\s*초|기다리|대기\s*시간/;

export interface ValidationOutcome {
  reclassifiedOk: boolean | null;
  vocabOk: boolean;
  notCopiedOk: boolean;
  questionLineScopeOk: boolean;
  responseLineRequiredOk: boolean;
  responseLineFirstPersonOk: boolean;
  responseLineRevisedOk: boolean | null;
  noAnswerLeakOk: boolean;
  noAnswerLeakInQuestionOk: boolean;
  quotesGroundedOk: boolean;
  whatWhyIsolatedOk: boolean;
  hintQuestionLineRequiredOk: boolean;
  noAnswerLeakInHintOk: boolean;
  hintNotRestatementOk: boolean;
  actionScopeOk: boolean;
  praisedQuoteGroundedOk: boolean;
  whatWhyCoverageOk: boolean;
  notes: string[];
}

function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function extractNumbers(text: string): string[] {
  return Array.from(text.matchAll(/\d+/g)).map((m) => m[0]);
}

async function judgeYesNo(
  systemPrompt: string,
  payload: Record<string, unknown>,
  schemaName: string
): Promise<{ value: boolean; reason: string }> {
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
            value: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["value", "reason"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error(`${schemaName} 판정 응답이 비어있습니다.`);
  return JSON.parse(content) as { value: boolean; reason: string };
}

/**
 * 개선 발문이 바로 다음 학생 발화의 결론(정답·핵심 주장)을 교사가 먼저 말해버렸는지
 * 의미 단위로 판단한다 (숫자만 보는 코드 검사와 별개로, 결론 문장 구조 자체를 먼저
 * 말해버리는 경우를 잡기 위함).
 */
function judgeConclusionLeak(revisedQuestionText: string, nextAnswerText: string) {
  return judgeYesNo(
    `당신은 초등 수학 수업 발문을 검토하는 전문가입니다.
개선된 교사 발문과, 그 발문 바로 다음에 나온 학생 발화를 봅니다.
개선된 발문이 학생 발화의 결론(정답·핵심 주장)을 교사가 먼저 말해버렸는지 판단하세요.
학생이 스스로 생각해서 답해야 할 결론을 교사가 발문 안에서 이미 확정해서 말해버렸으면
true입니다. 단순히 같은 주제나 숫자를 자연스럽게 언급했을 뿐 결론 자체를 먼저
말한 것이 아니면 false입니다. {value: boolean, reason: 한국어 1문장}으로 답하세요.`,
    { revisedQuestionText, nextAnswerText },
    "conclusion_leak_check"
  );
}

/**
 * 힌트 발문이 원래 발문을 말만 바꿔 다시 묻는 것인지(핵심 내용이 같은지) 판단한다.
 * 힌트는 답을 주지 않되 구체물·비교·그림 등 새로운 생각의 실마리를 줘야 하므로,
 * 단순 재질문이면 실패로 본다.
 */
function judgeHintIsRestatement(originalQuestionText: string, hintQuestionLine: string) {
  return judgeYesNo(
    `당신은 초등 수학 수업 발문을 검토하는 전문가입니다.
원래 발문과, 학생 반응이 없을 때 쓸 힌트 발문을 봅니다.
힌트 발문이 원래 발문과 핵심 내용(묻는 것 자체)이 같고 말투·어순만 바꾼 재질문인지
판단하세요. 힌트는 정답을 주지 않으면서도 구체물을 보여주거나, 더 쉬운 수로 먼저
비교해보게 하거나, 그림을 그려보게 하는 등 원래 발문과는 다른 새로운 생각의 실마리를
줘야 합니다. 그런 새로운 실마리 없이 같은 질문을 다르게 말한 것뿐이면 true입니다.
{value: boolean, reason: 한국어 1문장}으로 답하세요.`,
    { originalQuestionText, hintQuestionLine },
    "hint_restatement_check"
  );
}

/**
 * 문장형 기준(Q1·Q2·Q4·Q9, 병합된 것 제외)이 없으면 revisedQuestionLine을, Q3가 없으면
 * hintQuestionLine을, Q6·Q7·Q8이 전혀 없으면 revisedResponseLine을 코드가 강제로 null로
 * 정정한다. actions에서 이 그룹에 없는(병합 포함) 기준, Q3·Q5의 항목은 코드가 조용히
 * 버린다. whatAndWhy에서는 Q3·Q5(둘 다 코드 템플릿)의 항목만 버리고, 병합된 기준
 * (예: 자문자답 발화 자체에 걸린 Q4)은 그대로 둔다 — 병합돼도 그 기준만의 설명은
 * 별도 whatAndWhy 항목으로 남아야 한다(사용자 요청, 커버리지 검증 대상).
 */
export function normalizeSuggestionScope(
  raw: RawSuggestionResult,
  group: QuestionFindingsGroup
): { raw: RawSuggestionResult; corrected: string[] } {
  const ownCriteriaIds = new Set(group.findings.filter((f) => !f.mergeNote).map((f) => f.criterionId));
  const allCriteriaIds = new Set(group.findings.map((f) => f.criterionId));
  const validActionCriteriaIds = new Set([...ownCriteriaIds].filter((id) => id !== "Q3" && id !== "Q5"));
  const validWhatWhyCriteriaIds = new Set([...allCriteriaIds].filter((id) => id !== "Q3" && id !== "Q5"));

  const mustRewriteQuestion = [...ownCriteriaIds].some((id) => SENTENCE_CRITERIA.has(id));
  const hasQ3 = group.findings.some((f) => f.criterionId === "Q3");
  const hasReactionCriteria = ["Q6", "Q7", "Q8"].some((id) => ownCriteriaIds.has(id));

  const corrected: string[] = [];
  let next = { ...raw };

  if (!mustRewriteQuestion && next.revisedQuestionLine !== null) {
    corrected.push("문장형 기준이 없어 revisedQuestionLine을 null로 정정");
    next = { ...next, revisedQuestionLine: null };
  }
  if (!hasQ3 && next.hintQuestionLine !== null) {
    corrected.push("Q3가 없어 hintQuestionLine을 null로 정정");
    next = { ...next, hintQuestionLine: null };
  }
  if (!hasReactionCriteria && next.revisedResponseLine !== null) {
    corrected.push("Q6·Q7·Q8이 없어 revisedResponseLine을 null로 정정");
    next = { ...next, revisedResponseLine: null };
  }

  const droppedActions = next.actions.filter((a) => !validActionCriteriaIds.has(a.criterionId));
  if (droppedActions.length > 0) {
    for (const a of droppedActions) corrected.push("그룹에 없는(또는 Q3·Q5) 기준의 actions 항목을 버림");
    next = { ...next, actions: next.actions.filter((a) => validActionCriteriaIds.has(a.criterionId)) };
  }

  const droppedWhatWhy = next.whatAndWhy.filter((w) => !validWhatWhyCriteriaIds.has(w.criterionId));
  if (droppedWhatWhy.length > 0) {
    for (const w of droppedWhatWhy) corrected.push("그룹에 없는(또는 Q3·Q5) 기준의 whatAndWhy 항목을 버림");
    next = { ...next, whatAndWhy: next.whatAndWhy.filter((w) => validWhatWhyCriteriaIds.has(w.criterionId)) };
  }

  return { raw: next, corrected };
}

/**
 * 개선안을 코드로 검증한다 (전부 normalizeSuggestionScope로 범위를 맞춘 뒤 호출한다는
 * 전제). 각 항목은 다음과 같다:
 * 1. notCopiedOk: revisedQuestionLine이 원래 발문과 글자까지 같으면 실패.
 * 2. reclassifiedOk: 문장형 기준이 있으면 revisedQuestionLine을 Q1·Q2·Q4·Q9 전부 +
 *    isQuestion=true로 재검증.
 * 3. vocabOk: revisedQuestionLine·hintQuestionLine·revisedResponseLine 모두 3단계
 *    "아직 모름 확정" 용어 포함 여부.
 * 4. responseLineRequiredOk: Q6·Q7·Q8이 있는데 revisedResponseLine이 없으면 실패.
 * 5. responseLineRevisedOk: revisedResponseLine을 Q6/Q8 원자적 판정으로 재검증 —
 *    Q6이 있으면 "평가만 하고 캐묻지 않음"이 여전히 성립하면 실패, Q8이 있으면
 *    "칭찬 표현이 있고 구체적임" 또는 "학생 말 되짚기" 중 하나여야 통과.
 * 6. noAnswerLeakOk: Q7이 있으면 revisedResponseLine에 정답 값이 들어있으면 실패.
 * 7. noAnswerLeakInQuestionOk: revisedQuestionLine에 다음 학생 발화의 숫자(코드) 또는
 *    결론(LLM 의미 판단)이 미리 들어있으면 실패.
 * 8. quotesGroundedOk: whatAndWhy의 quotedOriginalText가 실제 발화에 있는지.
 * 9. whatWhyIsolatedOk: Q1 전용 "먼저~묻고" 순서 문구가 Q5 항목에 섞이지 않았는지.
 * 10. hintQuestionLineRequiredOk: Q3가 있는데 hintQuestionLine이 없으면 실패.
 * 11. noAnswerLeakInHintOk: Q3가 있으면 hintQuestionLine에 자문자답 답 값이 들어있으면 실패.
 * 12. hintNotRestatementOk: hintQuestionLine이 원래 발문의 재질문이면 실패(LLM 의미 판단).
 * 13. actionScopeOk: actions의 어떤 항목에도 대기시간 문구가 있으면 실패(항상 코드 담당).
 * 14. praisedQuoteGroundedOk: Q8이 "구체적 칭찬" 방식일 때만, praisedStudentQuote가
 *     실제 학생 발화에 있는지 확인("되짚기" 방식이면 요구하지 않음).
 * 15. whatWhyCoverageOk: 대상 기준(병합 포함) 중 Q3·Q5(코드 템플릿)를 뺀 나머지가
 *     whatAndWhy에 전부 있는지 확인 — 빠진 기준이 있으면 실패.
 */
export async function validateSuggestionContent(
  raw: RawSuggestionResult,
  group: QuestionFindingsGroup,
  concept: ConceptMatch,
  transcript: NormalizedTranscript
): Promise<ValidationOutcome> {
  const notes: string[] = [];
  const originalText = group.question.segment.text;
  const idx = group.question.segment.index;

  const ownCriteriaIds = new Set(group.findings.filter((f) => !f.mergeNote).map((f) => f.criterionId));
  const allCriteriaIds = new Set(group.findings.map((f) => f.criterionId));
  const mustRewriteQuestion = [...ownCriteriaIds].some((id) => SENTENCE_CRITERIA.has(id));
  const hasQ3 = group.findings.some((f) => f.criterionId === "Q3");
  const hasQ6 = ownCriteriaIds.has("Q6");
  const hasQ7 = ownCriteriaIds.has("Q7");
  const hasQ8 = ownCriteriaIds.has("Q8");
  const needsResponseLine = hasQ6 || hasQ7 || hasQ8;

  // scope는 normalizeSuggestionScope가 이미 맞춰줬다고 가정 — 여기서는 항상 true
  const questionLineScopeOk = true;

  // 1. 복사 방지
  let notCopiedOk = true;
  if (raw.revisedQuestionLine !== null && raw.revisedQuestionLine.trim() === originalText.trim()) {
    notCopiedOk = false;
    notes.push("개선 발문(revisedQuestionLine)이 원래 발문과 완전히 같음 (복사됨)");
  }

  // 2. 재분류 검증
  let reclassifiedOk: boolean | null = null;
  if (mustRewriteQuestion) {
    if (raw.revisedQuestionLine === null) {
      reclassifiedOk = false;
      notes.push("문장형 기준이 걸려있는데 개선 발문(revisedQuestionLine)이 비어있음");
    } else {
      const syntheticCandidate: QuestionCandidate = {
        segment: { ...group.question.segment, text: raw.revisedQuestionLine },
        questionMarkCount: countQuestionMarks(raw.revisedQuestionLine),
      };
      const { questions, findings } = await classifyAndCheckQuestions([syntheticCandidate]);
      const isQuestion = questions.length > 0;
      reclassifiedOk = isQuestion && findings.length === 0;
      if (!isQuestion) notes.push("개선 발문이 발문으로 인식되지 않음 (isQuestion=false)");
      for (const f of findings) notes.push(`개선 발문이 ${f.criterionId}에 다시 걸림: ${f.reason}`);
    }
  }

  // 3. 용어 검증 — 3단계 결과(원래 전사본에 실제로 나온 용어)만 보지 않고,
  // math-terms.json을 5단계가 새로 만든 문장에 직접 대조한다. 힌트 발문처럼 원래
  // 전사본에는 없던 새 문장에 상위 학년 용어가 섞여 들어가는 경우를 잡기 위함이다.
  const vocabHits: string[] = [];
  const vocabFields: Array<[string, string | null]> = [
    ["개선 발문", raw.revisedQuestionLine],
    ["힌트 발문", raw.hintQuestionLine],
    ["교사 반응 대사", raw.revisedResponseLine],
  ];
  for (const [label, text] of vocabFields) {
    if (text === null) continue;
    const hit = detectKnownTermsInText(text, concept).find((h) => h.category === "certain_unknown");
    if (hit) vocabHits.push(`${label}에 아직 모름 확정 용어 포함: "${hit.term}" (${hit.reason})`);
  }
  notes.push(...vocabHits);
  const vocabOk = vocabHits.length === 0;

  // 4. 반응 대사 필수 여부
  let responseLineRequiredOk = true;
  if (needsResponseLine && !raw.revisedResponseLine) {
    responseLineRequiredOk = false;
    notes.push("Q6·Q7·Q8이 있는데 교사 반응 대사(revisedResponseLine)가 비어있음");
  }

  // 4-1. 3인칭 표현 검증 — guidelines에 "직접 말을 거는 투로 쓴다"고 적어도 LLM이
  // "학생이 ~라고 답했구나"처럼 3인칭으로 되돌아가는 경우가 있어 코드로도 막는다.
  let responseLineFirstPersonOk = true;
  const THIRD_PERSON_PATTERN = /학생(이|은|을|께서|에게)/;
  if (raw.revisedResponseLine && THIRD_PERSON_PATTERN.test(raw.revisedResponseLine)) {
    responseLineFirstPersonOk = false;
    notes.push(
      `교사 반응 대사(revisedResponseLine)가 3인칭으로 학생을 지칭함(직접 말을 거는 투로 써야 함): "${raw.revisedResponseLine}"`
    );
  }

  // 5·14. 반응 대사 재판정 (Q6/Q8이 대상 기준이 아니어도 항상 재판정한다 — Q6을
  // 고치다가 "답을 잘 말해 주었어요"처럼 새로운 막연한 칭찬을 만드는 경우가 있어서,
  // 대상 기준과 무관하게 항상 확인한다) + Q8 칭찬 인용 근거 (칭찬 방식일 때만 요구)
  let responseLineRevisedOk: boolean | null = null;
  let praisedQuoteGroundedOk = true;
  if (raw.revisedResponseLine) {
    const judged = await judgeSingleResponse({
      precedingQuestionText: originalText,
      studentAnswerText: "(개선안 검증용 — 실제 학생 답변 아님)",
      responseTexts: [raw.revisedResponseLine],
      nextQuestionText: null,
    });
    const q6Ok = !hasQ6 || !(judged.q6HasEvaluativeExpression.value && !judged.hasProbingInWindow.value);
    const usesPraisePath = judged.q8HasPraiseExpression.value && judged.q8IsSpecific.value;
    const usesReflectPath = judged.reflectsStudentWords.value;
    // Q8이 대상 기준이면 "구체적 칭찬 또는 되짚기" 중 하나를 요구하고, 대상 기준이
    // 아니어도 "막연한 칭찬을 새로 만들지 않았는지"는 항상 확인한다.
    const introducesVaguePraise = judged.q8HasPraiseExpression.value && !usesPraisePath && !usesReflectPath;
    const q8Ok = hasQ8 ? usesPraisePath || usesReflectPath : !introducesVaguePraise;
    responseLineRevisedOk = q6Ok && q8Ok;
    if (!q6Ok) notes.push(`교사 반응 대사가 여전히 평가만 하고 캐묻지 않음: ${judged.q6HasEvaluativeExpression.reason}`);
    if (!q8Ok) {
      const label = hasQ8 ? "구체적 칭찬도, 학생 말 되짚기도 아님" : "새로운 막연한 칭찬을 만듦";
      notes.push(
        `교사 반응 대사가 ${label}(칭찬 있음=${judged.q8HasPraiseExpression.value}, 구체적=${judged.q8IsSpecific.value}, 되짚기=${judged.reflectsStudentWords.value}): ${judged.q8HasPraiseExpression.reason} / ${judged.q8IsSpecific.reason} / ${judged.reflectsStudentWords.reason}`
      );
    }

    // "구체적 칭찬" 경로를 쓴 것으로 판정됐을 때만 인용 근거를 요구한다 — 되짚기
    // 경로는 praisedStudentQuote 없이도 통과한다(사용자 요청).
    if (hasQ8 && usesPraisePath) {
      const quote = raw.praisedStudentQuote?.trim();
      if (!quote) {
        praisedQuoteGroundedOk = false;
        notes.push("Q8이 구체적 칭찬 방식인데 praisedStudentQuote가 비어있음");
      } else {
        const studentTexts = group.findings
          .filter((f) => f.criterionId === "Q8")
          .flatMap((f) => f.segments)
          .filter((s) => s.speaker === "student")
          .map((s) => s.text);
        const grounded = studentTexts.some((text) => text.includes(quote));
        if (!grounded) {
          praisedQuoteGroundedOk = false;
          notes.push(`praisedStudentQuote("${quote}")가 실제 학생 발화에 없음`);
        }
      }
    }
  }

  // 6. Q7 정답 유출 검증 (반응 대사)
  let noAnswerLeakOk = true;
  const answerToAvoid = raw.q7AnswerValueToAvoid?.trim();
  if (hasQ7 && answerToAvoid && raw.revisedResponseLine && raw.revisedResponseLine.includes(answerToAvoid)) {
    noAnswerLeakOk = false;
    notes.push(`교사 반응 대사(revisedResponseLine)에 정답("${answerToAvoid}")이 그대로 들어있음`);
  }

  // 7. 개선 발문에 다음 학생 답의 결론이 미리 들어있는지. 코드는 숫자만 보고(이미
  // 그 수업에서 누군가 먼저 말한 숫자는 "누설"이 아니므로 그 이전 발화 전체와
  // 대조한다), LLM은 숫자와 무관한 결론 문장 구조 자체를 의미로 판단한다.
  let noAnswerLeakInQuestionOk = true;
  if (raw.revisedQuestionLine) {
    const nextSegment = transcript.segments[idx + 1];
    if (nextSegment && nextSegment.speaker === "student") {
      const answerNumbers = extractNumbers(nextSegment.text);
      const priorNumbers = new Set(
        transcript.segments.slice(0, idx + 1).flatMap((s) => extractNumbers(s.text))
      );
      const leaked = answerNumbers.filter(
        (n) => !priorNumbers.has(n) && raw.revisedQuestionLine!.includes(n)
      );
      if (leaked.length > 0) {
        noAnswerLeakInQuestionOk = false;
        notes.push(
          `개선 발문에 다음 학생 답변([${nextSegment.index}] "${nextSegment.text}")의 숫자(${leaked.join(", ")})가 미리 들어있음`
        );
      }

      const conclusionLeak = await judgeConclusionLeak(raw.revisedQuestionLine, nextSegment.text);
      if (conclusionLeak.value) {
        noAnswerLeakInQuestionOk = false;
        notes.push(
          `개선 발문이 다음 학생 답변([${nextSegment.index}] "${nextSegment.text}")의 결론을 먼저 말함: ${conclusionLeak.reason}`
        );
      }
    }
  }

  // 10·11·12. 힌트 발문 필수 여부 + 자문자답 답 누설 + 원래 발문 재질문 여부
  let hintQuestionLineRequiredOk = true;
  let noAnswerLeakInHintOk = true;
  let hintNotRestatementOk = true;
  if (hasQ3) {
    if (!raw.hintQuestionLine) {
      hintQuestionLineRequiredOk = false;
      notes.push("Q3가 있는데 힌트 발문(hintQuestionLine)이 비어있음");
    } else {
      // 원래 발문 자체에 이미 있던 표현(예: 두 선택지 중 하나의 이름)이면 "누설"이
      // 아니다 — 자문자답으로 새로 확정해서 알려준 결론일 때만 실패로 본다.
      const q3AnswerToAvoid = raw.q3AnswerValueToAvoid?.trim();
      if (
        q3AnswerToAvoid &&
        !originalText.includes(q3AnswerToAvoid) &&
        raw.hintQuestionLine.includes(q3AnswerToAvoid)
      ) {
        noAnswerLeakInHintOk = false;
        notes.push(`힌트 발문(hintQuestionLine)에 자문자답으로 이미 준 답("${q3AnswerToAvoid}")이 그대로 들어있음`);
      }

      const restatement = await judgeHintIsRestatement(originalText, raw.hintQuestionLine);
      if (restatement.value) {
        hintNotRestatementOk = false;
        notes.push(`힌트 발문(hintQuestionLine)이 원래 발문의 재질문에 불과함: ${restatement.reason}`);
      }
    }
  }

  // 13. actions 범위 검증 — 대기시간 문구는 항상 코드가 붙이므로 LLM의 actions나
  // Q3의 whatAndWhy에는 절대 있으면 안 된다("N초"처럼 숫자를 모를 때 쓰는 자리표시자
  // 포함) — LLM이 숫자를 모른 채 자리표시자를 쓰는 사고가 있어서 추가했다.
  let actionScopeOk = true;
  const contaminatedActions = raw.actions.filter((a) => WAIT_ACTION_PATTERN.test(a.action));
  if (contaminatedActions.length > 0) {
    actionScopeOk = false;
    notes.push(
      `actions에 대기시간 문구가 있음(항상 코드가 담당): ${contaminatedActions
        .map((a) => `${a.criterionId}: "${a.action}"`)
        .join("; ")}`
    );
  }
  // Q3의 why는 "왜 자문자답이 문제인지"를 설명하는 자리라 "기다리다" 같은 일반
  // 표현은 정상이다 — 숫자(또는 "N초" 자리표시자)만 있으면 안 된다.
  const Q3_SECONDS_PATTERN = /\d+(\.\d+)?\s*초|N\s*초/;
  const contaminatedQ3Reason = raw.whatAndWhy.find(
    (w) => w.criterionId === "Q3" && Q3_SECONDS_PATTERN.test(`${w.what} ${w.why}`)
  );
  if (contaminatedQ3Reason) {
    actionScopeOk = false;
    notes.push(
      `Q3의 whatAndWhy에 대기시간 문구(숫자 또는 "N초" 자리표시자)가 있음(항상 코드가 담당): "${contaminatedQ3Reason.what}"`
    );
  }

  // 8. 인용 근거 검증
  const corpus = [originalText, ...group.findings.flatMap((f) => f.segments.map((s) => s.text))];
  const ungroundedNotes: string[] = [];
  for (const w of raw.whatAndWhy) {
    const quote = w.quotedOriginalText?.trim() ?? "";
    const grounded = quote.length > 0 && corpus.some((text) => text.includes(quote));
    if (!grounded) {
      ungroundedNotes.push(`${w.criterionId}의 인용구("${w.quotedOriginalText}")가 원문에 없거나 비어있음`);
    }
  }
  notes.push(...ungroundedNotes);
  const quotesGroundedOk = ungroundedNotes.length === 0;

  // 9. 기준별 설명 분리 검증 — 사용자 결정에 따라 Q5 항목에만 적용한다(Q5는 코드
  // 템플릿만 쓰므로 raw.whatAndWhy에 Q5가 실제로 나타나는 일은 없다 — 회귀 안전망).
  const isolationNotes: string[] = [];
  for (const w of raw.whatAndWhy) {
    if (w.criterionId === "Q5" && Q1_SEQUENCING_PATTERN.test(w.what)) {
      isolationNotes.push(`Q5의 이유에 Q1 전용 순서 문구("먼저~묻고")가 섞여 있음: "${w.what}"`);
    }
  }
  notes.push(...isolationNotes);
  const whatWhyIsolatedOk = isolationNotes.length === 0;

  // 15. whatAndWhy 커버리지 검증 — Q3·Q5(코드 템플릿)를 뺀 대상 기준(병합 포함)마다
  // whatAndWhy 항목이 하나씩 있어야 한다. 병합된 기준도 이제 별도 항목이 필요하다
  // (예: 자문자답 발화 자체에 걸린 Q4는 "왜 유도 발문 형태인지" 스스로 설명해야 함).
  const requiredWhatWhyCriteriaIds = [...allCriteriaIds].filter((id) => id !== "Q3" && id !== "Q5");
  const presentWhatWhyCriteriaIds = new Set(raw.whatAndWhy.map((w) => w.criterionId));
  const missingWhatWhyCriteriaIds = requiredWhatWhyCriteriaIds.filter((id) => !presentWhatWhyCriteriaIds.has(id));
  if (missingWhatWhyCriteriaIds.length > 0) {
    notes.push(`whatAndWhy에 대상 기준 중 누락된 항목이 있음: ${missingWhatWhyCriteriaIds.join(", ")}`);
  }
  const whatWhyCoverageOk = missingWhatWhyCriteriaIds.length === 0;

  return {
    reclassifiedOk,
    vocabOk,
    notCopiedOk,
    questionLineScopeOk,
    responseLineRequiredOk,
    responseLineFirstPersonOk,
    responseLineRevisedOk,
    noAnswerLeakOk,
    noAnswerLeakInQuestionOk,
    quotesGroundedOk,
    whatWhyIsolatedOk,
    hintQuestionLineRequiredOk,
    noAnswerLeakInHintOk,
    hintNotRestatementOk,
    actionScopeOk,
    praisedQuoteGroundedOk,
    whatWhyCoverageOk,
    notes,
  };
}

export function isSuggestionFailed(o: ValidationOutcome): boolean {
  return (
    o.reclassifiedOk === false ||
    !o.vocabOk ||
    !o.notCopiedOk ||
    !o.questionLineScopeOk ||
    !o.responseLineRequiredOk ||
    !o.responseLineFirstPersonOk ||
    o.responseLineRevisedOk === false ||
    !o.noAnswerLeakOk ||
    !o.noAnswerLeakInQuestionOk ||
    !o.quotesGroundedOk ||
    !o.whatWhyIsolatedOk ||
    !o.hintQuestionLineRequiredOk ||
    !o.noAnswerLeakInHintOk ||
    !o.hintNotRestatementOk ||
    !o.actionScopeOk ||
    !o.praisedQuoteGroundedOk ||
    !o.whatWhyCoverageOk
  );
}
