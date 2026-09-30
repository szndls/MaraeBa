import type { NormalizedTranscript } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import type { Suggestion, QuestionFindingsGroup, WhatWhy } from "../types/suggestion.js";
import type { WaitTimeEvaluation } from "../questioning/checkWaitTime.js";
import { computeWaitTimeAdvice, computeTargetWaitSeconds } from "../questioning/checkWaitTime.js";
import { groupFindingsByQuestion } from "./groupFindingsByQuestion.js";
import { generateSuggestionsForGroups, type GenerationCase, type RawSuggestionResult } from "./generateSuggestion.js";
import {
  validateSuggestionContent,
  normalizeSuggestionScope,
  isSuggestionFailed,
  type ValidationOutcome,
} from "./validateSuggestion.js";

const WAIT_ACTION_PATTERN = /\d+(\.\d+)?\s*초|기다리|대기\s*시간/;

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function bump(tally: Record<string, number>, key: string) {
  tally[key] = (tally[key] ?? 0) + 1;
}

function formatSeconds(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

/** LLM이 만든 행동 문구 여러 개를 한 문장씩 이어 붙일 때, 마침표가 없으면 붙여서
 *  "묻기 학생의"처럼 문장 경계가 안 보이는 문제를 막는다. */
function ensureSentenceEnd(s: string): string {
  const trimmed = s.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** 통계 표에 쓸 검증 항목 이름 — run.ts와 리뷰 문서 생성 스크립트가 공유한다. */
export const VALIDATION_CATEGORY_LABELS: Record<string, string> = {
  reclassifiedOk: "개선 발문 재분류 실패 (Q1·Q2·Q4·Q9)",
  vocabOk: "아직 모름 확정 용어 포함",
  notCopiedOk: "개선 발문이 원문 그대로 복사됨",
  questionLineScopeOk: "개선 발문 범위 벗어남 (문장형 기준 없는데 채움)",
  responseLineRequiredOk: "교사 반응 대사 누락 (Q6·Q7·Q8 있는데 없음)",
  responseLineFirstPersonOk: "교사 반응 대사가 3인칭(학생이~)으로 쓰임",
  responseLineRevisedOk: "교사 반응 대사 재판정 실패 (Q6 평가만/Q8 칭찬도 되짚기도 아님)",
  noAnswerLeakOk: "반응 대사에 정답 유출 (Q7)",
  noAnswerLeakInQuestionOk: "개선 발문에 학생 답 누설 (숫자/의미)",
  quotesGroundedOk: "인용구가 원문에 없음",
  whatWhyIsolatedOk: "Q5 이유에 Q1 순서 문구 혼입",
  hintQuestionLineRequiredOk: "힌트 발문 누락 (Q3 있는데 없음)",
  noAnswerLeakInHintOk: "힌트 발문에 자문자답 답 누설",
  hintNotRestatementOk: "힌트 발문이 원래 발문의 재질문에 불과함",
  actionScopeOk: "actions에 대기시간 문구 혼입 (항상 코드 담당)",
  praisedQuoteGroundedOk: "Q8 칭찬 인용구가 학생 발화에 없음",
  whatWhyCoverageOk: "whatAndWhy에 대상 기준 누락",
};

function tallyFailures(outcome: ValidationOutcome, tally: Record<string, number>) {
  if (outcome.reclassifiedOk === false) bump(tally, "reclassifiedOk");
  if (!outcome.vocabOk) bump(tally, "vocabOk");
  if (!outcome.notCopiedOk) bump(tally, "notCopiedOk");
  if (!outcome.questionLineScopeOk) bump(tally, "questionLineScopeOk");
  if (!outcome.responseLineRequiredOk) bump(tally, "responseLineRequiredOk");
  if (!outcome.responseLineFirstPersonOk) bump(tally, "responseLineFirstPersonOk");
  if (outcome.responseLineRevisedOk === false) bump(tally, "responseLineRevisedOk");
  if (!outcome.noAnswerLeakOk) bump(tally, "noAnswerLeakOk");
  if (!outcome.noAnswerLeakInQuestionOk) bump(tally, "noAnswerLeakInQuestionOk");
  if (!outcome.quotesGroundedOk) bump(tally, "quotesGroundedOk");
  if (!outcome.whatWhyIsolatedOk) bump(tally, "whatWhyIsolatedOk");
  if (!outcome.hintQuestionLineRequiredOk) bump(tally, "hintQuestionLineRequiredOk");
  if (!outcome.noAnswerLeakInHintOk) bump(tally, "noAnswerLeakInHintOk");
  if (!outcome.hintNotRestatementOk) bump(tally, "hintNotRestatementOk");
  if (!outcome.actionScopeOk) bump(tally, "actionScopeOk");
  if (!outcome.praisedQuoteGroundedOk) bump(tally, "praisedQuoteGroundedOk");
  if (!outcome.whatWhyCoverageOk) bump(tally, "whatWhyCoverageOk");
}

export interface ImprovementStats {
  /** 코드가 범위를 벗어난 필드를 null로 정정하거나 그룹에 없는 기준의 항목을 버린 횟수 (사유별) */
  scopeCorrections: Record<string, number>;
  /** 1차 생성이 실패해서 재생성된 사례의, 실패 사유별 건수 */
  regenerationFailures: Record<string, number>;
}

export interface GenerateImprovementsResult {
  suggestions: Suggestion[];
  stats: ImprovementStats;
}

export async function generateImprovements(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[],
  questioningFindings: QuestioningFinding[],
  conceptMatch: ConceptMatch,
  waitTimeEvaluations: WaitTimeEvaluation[]
): Promise<GenerateImprovementsResult> {
  const groups = groupFindingsByQuestion(questions, questioningFindings);
  if (groups.length === 0) return { suggestions: [], stats: { scopeCorrections: {}, regenerationFailures: {} } };

  const waitTimeAdviceByIndex = new Map<number, string>();
  const waitTimeEvaluationByIndex = new Map<number, WaitTimeEvaluation>();
  for (const e of waitTimeEvaluations) {
    waitTimeEvaluationByIndex.set(e.question.segment.index, e);
    const advice = computeWaitTimeAdvice(e);
    if (advice) waitTimeAdviceByIndex.set(e.question.segment.index, advice);
  }

  /** Q5(자기 소유, mergeNote 없음)가 있을 때만 그 그룹 자신의 대기시간으로 붙인다.
   *  병합된 Q5는 MERGE_NOTES대로 Q3의 행동이 이미 그 문제를 포함하므로 만들지 않는다. */
  function hasOwnQ5(group: QuestionFindingsGroup): boolean {
    return group.findings.some((f) => f.criterionId === "Q5" && !f.mergeNote);
  }

  function buildQ5ActionSentence(group: QuestionFindingsGroup): string | null {
    if (!hasOwnQ5(group)) return null;
    return waitTimeAdviceByIndex.get(group.question.segment.index) ?? null;
  }

  function buildQ3ActionSentence(group: QuestionFindingsGroup): string | null {
    const hasQ3 = group.findings.some((f) => f.criterionId === "Q3");
    if (!hasQ3) return null;
    const seconds = computeTargetWaitSeconds(group.question.questionType);
    if (seconds === null) return null;
    return `답을 말하지 말고 ${formatSeconds(seconds)}초 기다리기.`;
  }

  /**
   * Q5는 "정답이 정해진" 계산이라 LLM에 맡기지 않고 이유(whatAndWhy)까지 코드 템플릿
   * 문장으로 만든다. 관찰된 대기시간과 목표 대기시간을 그대로 문장에 넣는다.
   */
  function buildQ5Reason(group: QuestionFindingsGroup): WhatWhy | null {
    if (!hasOwnQ5(group)) return null;
    const evaluation = waitTimeEvaluationByIndex.get(group.question.segment.index);
    if (!evaluation || evaluation.waitTimeSec === null) return null;
    const target = computeTargetWaitSeconds(group.question.questionType);
    if (target === null) return null;

    const observed = formatSeconds(Math.round(evaluation.waitTimeSec * 10) / 10);
    const targetStr = formatSeconds(target);

    return {
      criterionId: "Q5",
      what: `발문 후 최소 ${targetStr}초 이상 기다리기`,
      why: `발문 후 ${observed}초 만에 다음 발화가 시작됐어요. 이 발문은 "${group.question.questionType}" 발문이라 최소 ${targetStr}초 기다리는 게 좋아요.`,
      quotedOriginalText: group.question.segment.text,
    };
  }

  /**
   * Q3도 "자문자답 발화 자체를 인용해서 왜 문제인지 말한다"는 점에서 정해진 틀이라
   * 코드 템플릿으로 만든다 — 사용자가 Q3·Q5를 같은 "코드 템플릿 기준"으로 묶어
   * 요청했다. 인용문은 자문자답 발화(Q3 finding의 segments[1], 즉 교사가 스스로
   * 답한 그 발화) 그대로 쓴다.
   */
  function buildQ3Reason(group: QuestionFindingsGroup): WhatWhy | null {
    const q3Finding = group.findings.find((f) => f.criterionId === "Q3");
    if (!q3Finding) return null;
    const selfAnswerText = q3Finding.segments[1]?.text ?? group.question.segment.text;
    return {
      criterionId: "Q3",
      what: "학생이 답하기 전에 교사가 스스로 답하지 않고 기다리기",
      why: `교사가 "${selfAnswerText}"라고 스스로 답을 말해서, 학생이 생각할 기회를 갖지 못했어요.`,
      quotedOriginalText: selfAnswerText,
    };
  }

  /**
   * 개선 행동 문구는 코드가 기준별로 직접 붙인다 — Q3·Q5는 항상 코드가 계산한 숫자로
   * 코드가 붙이고, LLM의 actions(이미 그룹에 있는 기준으로만 필터링됨)를 그 뒤에
   * 잇는다. 혹시 남아있을 대기시간 문구는 여기서도 한 번 더 걸러내 최종 결과에
   * 오염된 문구가 노출되지 않도록 한다.
   */
  function composeSuggestedAction(group: QuestionFindingsGroup, raw: RawSuggestionResult): string | null {
    const parts: string[] = [];
    const q3 = buildQ3ActionSentence(group);
    if (q3) parts.push(q3);
    const q5 = buildQ5ActionSentence(group);
    if (q5) parts.push(q5);
    for (const a of raw.actions) {
      if (!WAIT_ACTION_PATTERN.test(a.action)) parts.push(ensureSentenceEnd(a.action));
    }
    return parts.length > 0 ? parts.join(" ") : null;
  }

  function composeWhatAndWhy(group: QuestionFindingsGroup, raw: RawSuggestionResult): WhatWhy[] {
    const entries: WhatWhy[] = [...raw.whatAndWhy];
    const q3Reason = buildQ3Reason(group);
    if (q3Reason) entries.push(q3Reason);
    const q5Reason = buildQ5Reason(group);
    if (q5Reason) entries.push(q5Reason);
    return entries;
  }

  /** Q8·Q6·Q7 순으로 학생 답변 발화를 찾는다(어느 기준이든 같은 응답 사건의 학생
   *  발화를 가리키므로 우선순위는 크게 중요하지 않다 — 존재하는 것을 쓴다). */
  function findStudentAnswerText(group: QuestionFindingsGroup): string | null {
    for (const id of ["Q8", "Q6", "Q7"]) {
      const finding = group.findings.find((f) => f.criterionId === id);
      const studentSeg = finding?.segments.find((s) => s.speaker === "student");
      if (studentSeg) return studentSeg.text;
    }
    return null;
  }

  /**
   * 학생 발화 끝의 종결 어미(요/이요/예요/이에요)와 문장부호를 떼어, "그렇게 답했구나"
   * 뒤에 자연스럽게 이어지게 한다. 예: "4분의 1이요." → "4분의 1".
   */
  function stripSentenceEnding(text: string): string {
    let t = text.trim().replace(/["'“”'.!?~]+$/g, "").trim();
    for (const ending of ["이에요", "예요", "이요", "요"]) {
      if (t.endsWith(ending)) {
        t = t.slice(0, -ending.length);
        break;
      }
    }
    return t.trim();
  }

  /**
   * Q6/Q8 재판정이 재생성 후에도 실패하면(막연한 칭찬을 계속 만드는 등), 학생 발화를
   * 그대로 인용한 되짚기 문장으로 코드가 대체한다 — 되짚기는 항상 Q8 요건(칭찬도
   * 되짚기도 아님)과 Q6 요건(평가만 하지 않음, 판정 표현 자체가 없음)을 동시에
   * 만족한다. Q6이 대상 기준이면 이유 묻기 문장을 고정으로 덧붙인다(사용자 요청).
   */
  function buildCodeReplacementResponseLine(group: QuestionFindingsGroup, studentText: string): string {
    const hasQ6 = group.findings.some((f) => f.criterionId === "Q6" && !f.mergeNote);
    const reflect = `${stripSentenceEnding(studentText)}, 그렇게 답했구나.`;
    return hasQ6 ? `${reflect} 어떻게 알았어요?` : reflect;
  }

  const initialCases: GenerationCase[] = groups.map((group) => ({
    group,
    regenerationFeedback: null,
  }));

  const firstPass = await generateSuggestionsForGroups(initialCases, transcript, conceptMatch);

  const scopeCorrections: Record<string, number> = {};
  const regenerationFailures: Record<string, number> = {};

  const suggestions: Suggestion[] = [];
  const needsRegeneration: Array<{ group: QuestionFindingsGroup; raw: RawSuggestionResult; notes: string[] }> = [];

  for (const group of groups) {
    const idx = group.question.segment.index;
    const rawFetched = firstPass.get(idx);
    if (!rawFetched) {
      console.warn(`[개선안 생성] 발문(index=${idx})에 대한 결과가 없어 건너뜁니다.`);
      continue;
    }
    const { raw, corrected } = normalizeSuggestionScope(rawFetched, group);
    for (const c of corrected) bump(scopeCorrections, c);

    const outcome = await validateSuggestionContent(raw, group, conceptMatch, transcript);

    if (isSuggestionFailed(outcome)) {
      tallyFailures(outcome, regenerationFailures);
      needsRegeneration.push({ group, raw, notes: outcome.notes });
    } else {
      suggestions.push(
        buildSuggestion(group, raw, outcome, false, false, composeSuggestedAction, composeWhatAndWhy)
      );
    }
  }

  if (needsRegeneration.length > 0) {
    const retryCases: GenerationCase[] = needsRegeneration.map(({ group, notes }) => ({
      group,
      regenerationFeedback: `이전 시도가 다음 이유로 실패했습니다 — 다시 만들어 주세요: ${notes.join("; ")}`,
    }));

    const retryResults = await generateSuggestionsForGroups(retryCases, transcript, conceptMatch);

    for (const { group, raw: firstRaw } of needsRegeneration) {
      const idx = group.question.segment.index;
      const retryRawFetched = retryResults.get(idx) ?? firstRaw; // 재요청도 실패하면 1차 결과라도 유지
      const { raw: retryRaw, corrected } = normalizeSuggestionScope(retryRawFetched, group);
      for (const c of corrected) bump(scopeCorrections, c);

      let retryOutcome = await validateSuggestionContent(retryRaw, group, conceptMatch, transcript);
      let finalRaw = retryRaw;
      let usedCodeReplacement = false;

      if (retryOutcome.responseLineRevisedOk === false || !retryOutcome.responseLineFirstPersonOk) {
        const studentText = findStudentAnswerText(group);
        if (studentText) {
          const replacement = buildCodeReplacementResponseLine(group, studentText);
          finalRaw = { ...retryRaw, revisedResponseLine: replacement };
          usedCodeReplacement = true;
          // 이제 해소된 문제(Q6/Q8 재판정·3인칭 관련 옛 실패 메모)만 지우고, 대체로
          // 해결되지 않는 다른 문제(예: Q7 정답 유출)의 메모는 남긴다 — 안 그러면
          // 그 문제가 여전히 남아있는데 이유가 안 보이게 된다.
          const remainingNotes = retryOutcome.notes.filter(
            (n) =>
              !n.startsWith("교사 반응 대사가") &&
              !n.startsWith("교사 반응 대사(revisedResponseLine)가 3인칭")
          );
          retryOutcome = {
            ...retryOutcome,
            responseLineRevisedOk: true,
            responseLineFirstPersonOk: true,
            praisedQuoteGroundedOk: true,
            notes: [...remainingNotes, `코드 대체 대사 사용: "${replacement}"`],
          };
        }
      }

      const stillFailing = isSuggestionFailed(retryOutcome);

      suggestions.push(
        buildSuggestion(
          group,
          finalRaw,
          retryOutcome,
          true,
          stillFailing,
          composeSuggestedAction,
          composeWhatAndWhy,
          usedCodeReplacement
        )
      );
    }
  }

  suggestions.sort((a, b) => a.questionIndex - b.questionIndex);

  return { suggestions, stats: { scopeCorrections, regenerationFailures } };
}

function buildSuggestion(
  group: QuestionFindingsGroup,
  raw: RawSuggestionResult,
  outcome: ValidationOutcome,
  regenerated: boolean,
  stillFailingAfterRetry: boolean,
  composeSuggestedAction: (group: QuestionFindingsGroup, raw: RawSuggestionResult) => string | null,
  composeWhatAndWhy: (group: QuestionFindingsGroup, raw: RawSuggestionResult) => WhatWhy[],
  usedCodeReplacementResponseLine = false
): Suggestion {
  const targetReactionSegmentIndices = uniq(
    group.findings
      .map((f) => f.targetReactionSegmentIndex)
      .filter((n): n is number => n !== undefined && n !== null)
  );

  return {
    questionIndex: group.question.segment.index,
    originalQuestionText: group.question.segment.text,
    criteriaAddressed: uniq(group.findings.map((f) => f.criterionId)),
    revisedQuestionLine: raw.revisedQuestionLine,
    hintQuestionLine: raw.hintQuestionLine,
    revisedResponseLine: raw.revisedResponseLine,
    suggestedAction: composeSuggestedAction(group, raw),
    whatAndWhy: composeWhatAndWhy(group, raw),
    targetReactionSegmentIndices,
    validation: {
      reclassifiedOk: outcome.reclassifiedOk,
      vocabOk: outcome.vocabOk,
      notCopiedOk: outcome.notCopiedOk,
      questionLineScopeOk: outcome.questionLineScopeOk,
      responseLineRequiredOk: outcome.responseLineRequiredOk,
      responseLineFirstPersonOk: outcome.responseLineFirstPersonOk,
      responseLineRevisedOk: outcome.responseLineRevisedOk,
      noAnswerLeakOk: outcome.noAnswerLeakOk,
      noAnswerLeakInQuestionOk: outcome.noAnswerLeakInQuestionOk,
      quotesGroundedOk: outcome.quotesGroundedOk,
      whatWhyIsolatedOk: outcome.whatWhyIsolatedOk,
      hintQuestionLineRequiredOk: outcome.hintQuestionLineRequiredOk,
      noAnswerLeakInHintOk: outcome.noAnswerLeakInHintOk,
      hintNotRestatementOk: outcome.hintNotRestatementOk,
      actionScopeOk: outcome.actionScopeOk,
      praisedQuoteGroundedOk: outcome.praisedQuoteGroundedOk,
      whatWhyCoverageOk: outcome.whatWhyCoverageOk,
      usedCodeReplacementResponseLine,
      regenerated,
      stillFailingAfterRetry,
      notes: outcome.notes,
    },
    source: "ai",
  };
}
