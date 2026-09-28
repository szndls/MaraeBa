import type { NormalizedTranscript } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import type { VocabFinding } from "../types/vocab.js";
import type { Suggestion } from "../types/suggestion.js";
import type { WaitTimeEvaluation } from "../questioning/checkWaitTime.js";
import { computeWaitTimeAdvice } from "../questioning/checkWaitTime.js";
import { groupFindingsByQuestion } from "./groupFindingsByQuestion.js";
import { generateSuggestionsForGroups, type GenerationCase, type RawSuggestionResult } from "./generateSuggestion.js";
import { validateSuggestionContent } from "./validateSuggestion.js";

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export async function generateImprovements(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[],
  questioningFindings: QuestioningFinding[],
  vocabFindings: VocabFinding[],
  conceptMatch: ConceptMatch,
  waitTimeEvaluations: WaitTimeEvaluation[]
): Promise<Suggestion[]> {
  const groups = groupFindingsByQuestion(questions, questioningFindings);
  if (groups.length === 0) return [];

  const certainUnknownTerms = uniq(
    vocabFindings.filter((v) => v.category === "certain_unknown").map((v) => v.term)
  );

  const waitTimeAdviceByIndex = new Map<number, string>();
  for (const e of waitTimeEvaluations) {
    const advice = computeWaitTimeAdvice(e);
    if (advice) waitTimeAdviceByIndex.set(e.question.segment.index, advice);
  }

  const initialCases: GenerationCase[] = groups.map((group) => ({
    group,
    waitTimeAdvice: waitTimeAdviceByIndex.get(group.question.segment.index) ?? null,
    regenerationFeedback: null,
  }));

  const firstPass = await generateSuggestionsForGroups(initialCases, transcript, conceptMatch);

  const suggestions: Suggestion[] = [];
  const needsRegeneration: Array<{ group: (typeof groups)[number]; raw: RawSuggestionResult; notes: string[] }> = [];

  for (const group of groups) {
    const idx = group.question.segment.index;
    const raw = firstPass.get(idx);
    if (!raw) {
      console.warn(`[개선안 생성] 발문(index=${idx})에 대한 결과가 없어 건너뜁니다.`);
      continue;
    }

    const outcome = await validateSuggestionContent(raw, group.question.segment, certainUnknownTerms);
    const failed = outcome.reclassifiedOk === false || !outcome.vocabOk;

    if (failed) {
      needsRegeneration.push({ group, raw, notes: outcome.notes });
    } else {
      suggestions.push(buildSuggestion(group, raw, outcome, false, false));
    }
  }

  if (needsRegeneration.length > 0) {
    const retryCases: GenerationCase[] = needsRegeneration.map(({ group, notes }) => ({
      group,
      waitTimeAdvice: waitTimeAdviceByIndex.get(group.question.segment.index) ?? null,
      regenerationFeedback: `이전 시도가 다음 이유로 실패했습니다 — 다시 만들어 주세요: ${notes.join("; ")}`,
    }));

    const retryResults = await generateSuggestionsForGroups(retryCases, transcript, conceptMatch);

    for (const { group, raw: firstRaw } of needsRegeneration) {
      const idx = group.question.segment.index;
      const retryRaw = retryResults.get(idx) ?? firstRaw; // 재요청도 실패하면 1차 결과라도 유지

      const retryOutcome = await validateSuggestionContent(
        retryRaw,
        group.question.segment,
        certainUnknownTerms
      );
      const stillFailing = retryOutcome.reclassifiedOk === false || !retryOutcome.vocabOk;

      suggestions.push(buildSuggestion(group, retryRaw, retryOutcome, true, stillFailing));
    }
  }

  return suggestions;
}

function buildSuggestion(
  group: ReturnType<typeof groupFindingsByQuestion>[number],
  raw: RawSuggestionResult,
  outcome: { reclassifiedOk: boolean | null; vocabOk: boolean; notes: string[] },
  regenerated: boolean,
  stillFailingAfterRetry: boolean
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
    revisedQuestionText: raw.revisedQuestionText,
    suggestedAction: raw.suggestedAction,
    exampleTeacherLine: raw.exampleTeacherLine,
    whatAndWhy: raw.whatAndWhy,
    expectedStudentResponse: raw.expectedStudentResponse,
    targetReactionSegmentIndices,
    validation: {
      reclassifiedOk: outcome.reclassifiedOk,
      vocabOk: outcome.vocabOk,
      regenerated,
      stillFailingAfterRetry,
      notes: outcome.notes,
    },
    source: "ai",
  };
}
