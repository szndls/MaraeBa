import type { TranscriptSegment } from "../types/transcript.js";
import type { QuestionCandidate } from "../types/questioning.js";
import { classifyAndCheckQuestions } from "../questioning/classifyAndCheckQuestions.js";

export interface ValidationOutcome {
  /** revisedQuestionText가 없으면 null (검증 대상 아님) */
  reclassifiedOk: boolean | null;
  vocabOk: boolean;
  notes: string[];
}

function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

/**
 * 개선안을 코드로 검증한다.
 * 1. revisedQuestionText가 있으면, 원래 걸린 기준만이 아니라 문장형 기준(Q1·Q2·Q4·Q9)
 *    전부와 isQuestion=true 여부를 다시 확인한다 (classifyAndCheckQuestions 재사용).
 * 2. revisedQuestionText와 exampleTeacherLine 둘 다, 3단계 "아직 모름 확정" 용어가
 *    들어있는지 확인한다.
 */
export async function validateSuggestionContent(
  raw: { revisedQuestionText: string | null; exampleTeacherLine: string | null },
  originalSegment: TranscriptSegment,
  certainUnknownTerms: string[]
): Promise<ValidationOutcome> {
  const notes: string[] = [];
  let reclassifiedOk: boolean | null = null;

  if (raw.revisedQuestionText !== null) {
    const syntheticCandidate: QuestionCandidate = {
      segment: { ...originalSegment, text: raw.revisedQuestionText },
      questionMarkCount: countQuestionMarks(raw.revisedQuestionText),
    };
    const { questions, findings } = await classifyAndCheckQuestions([syntheticCandidate]);
    const isQuestion = questions.length > 0;
    reclassifiedOk = isQuestion && findings.length === 0;
    if (!isQuestion) notes.push("개선 발문이 발문으로 인식되지 않음 (isQuestion=false)");
    for (const f of findings) notes.push(`개선 발문이 ${f.criterionId}에 다시 걸림: ${f.reason}`);
  }

  const fieldsToCheck: Array<[string, string | null]> = [
    ["개선 발문", raw.revisedQuestionText],
    ["교사 예시 대사", raw.exampleTeacherLine],
  ];
  const vocabNotes: string[] = [];
  for (const [label, text] of fieldsToCheck) {
    if (text === null) continue;
    const hit = certainUnknownTerms.find((term) => text.includes(term));
    if (hit) vocabNotes.push(`${label}에 아직 모름 확정 용어 포함: "${hit}"`);
  }
  notes.push(...vocabNotes);

  return { reclassifiedOk, vocabOk: vocabNotes.length === 0, notes };
}
