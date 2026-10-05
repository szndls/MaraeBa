import type { NormalizedTranscript } from "../../src/types/transcript.js";
import type { QuestioningFinding } from "../../src/types/questioning.js";
import type { VocabCategory, VocabFinding } from "../../src/types/vocab.js";
import type { WaitTimeEvaluation } from "../../src/questioning/checkWaitTime.js";
import { groupForCriterion, type HighlightGroupKey } from "./highlightConfig.js";

export interface HighlightBadge {
  criterionId: string;
  criterionName: string;
  group: HighlightGroupKey;
}

export interface SegmentHighlight {
  /** 텍스트에 칠할 그룹. null이면 안 칠함(예: Q5만 걸린 발문 — 칩만 뜸) */
  group: HighlightGroupKey | null;
  /** 칠하는 데 쓰인 심각도 라벨 — strong/light 결정용 */
  severity: string | null;
  /** 이 발화에 걸린 모든 기준 배지(칠하는 색과 무관하게 전부) */
  badges: HighlightBadge[];
  /** Q5 전용: 이 발문 뒤에 뜰 대기시간 칩 */
  waitChip: { seconds: number | null; severity: string } | null;
  /** 3단계 용어 — 단어만 칠함 */
  vocabSpans: Array<{ term: string; category: VocabCategory }>;
}

function emptyHighlight(): SegmentHighlight {
  return { group: null, severity: null, badges: [], waitChip: null, vocabSpans: [] };
}

/**
 * src/criteria/loadQuestioningCriteria.ts의 severityRank와 같은 공식이다. 그 함수는
 * criteria/questioning-criteria.json을 node:fs로 읽어서 브라우저 번들에 넣을 수
 * 없으므로, 서버 컴포넌트가 미리 읽어 전달하는 심각도 순서 배열(severityOrder)로
 * 같은 계산을 여기서 다시 한다 — 정의가 두 곳이 아니라, "어디서 읽느냐"만 다르다.
 */
function severityRank(label: string, severityOrder: string[]): number {
  const idx = severityOrder.indexOf(label);
  return idx === -1 ? -1 : severityOrder.length - idx;
}

function applyPaintCandidate(
  highlight: SegmentHighlight,
  group: HighlightGroupKey,
  severity: string,
  severityOrder: string[]
) {
  const candidateRank = severityRank(severity, severityOrder);
  const currentRank = highlight.severity === null ? -Infinity : severityRank(highlight.severity, severityOrder);
  if (candidateRank >= currentRank) {
    highlight.group = group;
    highlight.severity = severity;
  }
}

/** targetReactionSegmentIndex가 없을 때: 발문 다음에 오는 첫 교사 발화를 반응으로 본다. */
function fallbackReactionIndex(finding: QuestioningFinding): number | null {
  const questionIdx = finding.targetQuestionIndex;
  const candidate = finding.segments.find(
    (s) => s.speaker === "teacher" && (questionIdx === null || s.index > questionIdx)
  );
  return candidate?.index ?? null;
}

export function computeSegmentHighlights(
  _transcript: NormalizedTranscript,
  questioningFindings: QuestioningFinding[],
  vocabFindings: VocabFinding[],
  waitTimeEvaluations: WaitTimeEvaluation[],
  severityOrder: string[]
): Map<number, SegmentHighlight> {
  const map = new Map<number, SegmentHighlight>();
  const ensure = (idx: number): SegmentHighlight => {
    let h = map.get(idx);
    if (!h) {
      h = emptyHighlight();
      map.set(idx, h);
    }
    return h;
  };

  for (const f of questioningFindings) {
    const group = groupForCriterion(f.criterionId);
    if (!group) continue;

    if (f.criterionId === "Q5") {
      if (f.targetQuestionIndex === null) continue;
      const h = ensure(f.targetQuestionIndex);
      h.badges.push({ criterionId: f.criterionId, criterionName: f.criterionName, group });
      const evaluation = waitTimeEvaluations.find(
        (e) => e.question.segment.index === f.targetQuestionIndex
      );
      h.waitChip = { seconds: evaluation?.waitTimeSec ?? null, severity: f.severity };
      continue; // Q5는 텍스트를 칠하지 않는다
    }

    if (f.criterionId === "Q3") {
      for (const seg of f.segments) {
        const h = ensure(seg.index);
        h.badges.push({ criterionId: f.criterionId, criterionName: f.criterionName, group });
        applyPaintCandidate(h, group, f.severity, severityOrder);
      }
      continue;
    }

    if (group === "question") {
      if (f.targetQuestionIndex === null) continue;
      const h = ensure(f.targetQuestionIndex);
      h.badges.push({ criterionId: f.criterionId, criterionName: f.criterionName, group });
      applyPaintCandidate(h, group, f.severity, severityOrder);
      continue;
    }

    if (group === "reaction") {
      const idx = f.targetReactionSegmentIndex ?? fallbackReactionIndex(f);
      if (idx === null || idx === undefined) continue;
      const h = ensure(idx);
      h.badges.push({ criterionId: f.criterionId, criterionName: f.criterionName, group });
      applyPaintCandidate(h, group, f.severity, severityOrder);
      continue;
    }
  }

  // src/report/computeLessonMetrics.ts의 dedupeOverlappingTerms와 같은 규칙 — "소인수"와
  // "소인수분해"가 둘 다 잡히면 긴 쪽만 칠한다. (그 함수는 L7 집계 전용으로 비공개라
  // 여기서 같은 규칙만 다시 쓴다.)
  const dedupedVocab = vocabFindings.filter(
    (f) => !vocabFindings.some((other) => other !== f && other.term.includes(f.term) && other.term.length > f.term.length)
  );

  for (const v of dedupedVocab) {
    for (const seg of v.foundInSegments) {
      const h = ensure(seg.index);
      h.vocabSpans.push({ term: v.term, category: v.category });
    }
  }

  return map;
}
