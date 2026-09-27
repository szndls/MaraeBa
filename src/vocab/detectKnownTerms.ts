import type { NormalizedTranscript, TranscriptSegment } from "../types/transcript.js";
import type { ConceptMatch } from "../types/concept.js";
import type { VocabFinding } from "../types/vocab.js";
import { buildTermIndex, getBandOrderIndex, type TermOccurrence } from "../criteria/loadMathTerms.js";

function parseStandardSuffix(code: string): number {
  const parts = code.split("-");
  const suffix = Number(parts[parts.length - 1]);
  if (Number.isNaN(suffix)) {
    throw new Error(`성취기준 코드 형식을 해석할 수 없습니다: ${code}`);
  }
  return suffix;
}

/**
 * math-terms.json의 how_to_use 규칙에 따라, 용어 하나의 발생 위치(occurrence)와
 * 2단계에서 매칭된 개념(currentConcept)을 비교해서 카테고리를 정한다.
 * null이면 "이미 배웠거나 판단 근거가 없어 플래그하지 않음".
 */
function categorize(
  occurrence: TermOccurrence,
  currentConcept: ConceptMatch
): { category: "certain_unknown" | "maybe_unknown"; reason: string } | null {
  if (occurrence.band === "middle_school") {
    return { category: "certain_unknown", reason: "중학교 이상에서 배우는 용어" };
  }

  const currentBandIdx = getBandOrderIndex(currentConcept.band);
  const termBandIdx = getBandOrderIndex(occurrence.band);

  if (termBandIdx > currentBandIdx) {
    return {
      category: "certain_unknown",
      reason: `상위 학년군(${occurrence.band}) 용어`,
    };
  }

  if (termBandIdx < currentBandIdx) {
    return null; // 이전 학년군에서 이미 배웠을 것으로 간주
  }

  // 같은 학년군
  if (occurrence.areaName !== currentConcept.areaName) {
    return null; // 다른 영역이라 순서를 판단할 근거가 없음
  }

  if (!occurrence.standardCode) {
    return {
      category: "maybe_unknown",
      reason: "같은 학년군·영역이지만 성취기준 순서가 명확하지 않아 보수적으로 표시",
    };
  }

  const termSuffix = parseStandardSuffix(occurrence.standardCode);
  const matchedSuffix = parseStandardSuffix(currentConcept.standardCode);

  if (termSuffix > matchedSuffix) {
    return {
      category: "maybe_unknown",
      reason: `같은 영역에서 ${currentConcept.standardCode}보다 뒤에 배우는 용어 (${occurrence.standardCode})`,
    };
  }

  return null; // 현재 또는 이전 성취기준에 속하는 용어라 이미 다루는 중이거나 배운 것으로 간주
}

export function detectKnownTerms(
  transcript: NormalizedTranscript,
  concept: ConceptMatch
): VocabFinding[] {
  const termIndex = buildTermIndex();
  const teacherSegments = transcript.segments.filter((s) => s.speaker === "teacher");

  const findings: VocabFinding[] = [];

  for (const [term, occurrences] of termIndex) {
    const matchedSegments: TranscriptSegment[] = teacherSegments.filter((s) =>
      s.text.includes(term)
    );
    if (matchedSegments.length === 0) continue;

    // 이 데이터셋에서는 용어가 한 곳에만 속한다고 가정하고 첫 occurrence로 판단
    const result = categorize(occurrences[0], concept);
    if (!result) continue;

    findings.push({
      term,
      category: result.category,
      reason: result.reason,
      foundInSegments: matchedSegments,
      basis: "rule",
    });
  }

  return findings;
}
