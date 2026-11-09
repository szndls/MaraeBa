import type { Speaker, TranscriptSegment } from "../types/transcript.js";

/**
 * STT가 한 호흡을 임의로 여러 세그먼트로 쪼개거나(겹질문이 안 보이게 됨), 여러 발화를
 * 한 세그먼트로 합쳐버리는(개선안 판정이 흔들림) 문제를 막기 위한 재구성 단계.
 *
 * 턴/문장은 탐지 시점에만 쓰는 내부 뷰다 — 모든 QuestioningFinding은 끝까지 원본
 * transcript.segments의 실제 index만 참조해야 한다(안정 ID·지적 무시·분석 캐시가
 * 전부 거기에 기대고 있음). 이 파일의 함수들은 "원본 세그먼트를 어떻게 묶어서 볼지"만
 * 계산하고, 묶은 결과에 새 번호를 매기지 않는다 — Turn.segments/Sentence.sourceSegments는
 * 항상 원본 TranscriptSegment 참조 그대로다.
 */

export interface Turn {
  speaker: Speaker;
  /** 이 턴에 속한 원본 세그먼트, 시간 순서대로. 1개면 STT가 쪼개지 않은 평범한 경우. */
  segments: TranscriptSegment[];
}

export interface Sentence {
  /** 문장부호로 쪼갠 텍스트(앞뒤 공백 제거됨) */
  text: string;
  /** 이 문장이 걸쳐 있는 원본 세그먼트(보통 1개, 턴이 여러 세그먼트를 합친 경우 여러 개일 수 있음) */
  sourceSegments: TranscriptSegment[];
}

/**
 * 같은 화자가 연속으로 나오고 그 사이 간격이 maxGapSec 이하이면 한 턴으로 묶는다.
 * 화자가 바뀌면 간격과 무관하게 턴이 끝난다. 반드시 전체 세그먼트 배열(화자 섞인 그대로)을
 * 넘겨야 한다 — 미리 화자별로 걸러내면 그 사이에 있던 다른 화자의 발화 때문에 생긴
 * 턴 경계가 사라진다.
 */
export function buildTurns(segments: TranscriptSegment[], maxGapSec: number): Turn[] {
  const turns: Turn[] = [];

  for (const segment of segments) {
    const current = turns[turns.length - 1];
    const lastSegment = current?.segments[current.segments.length - 1];
    const gap = lastSegment ? segment.start - lastSegment.end : Infinity;

    if (current && current.speaker === segment.speaker && gap <= maxGapSec) {
      current.segments.push(segment);
    } else {
      turns.push({ speaker: segment.speaker, segments: [segment] });
    }
  }

  return turns;
}

/** generateImprovements.ts의 extractLastSentence와 같은 문장부호 패턴 — 일관성을 위해 공유하지는
 *  않고 똑같은 정규식만 재사용한다(그 파일은 "마지막 문장"만 필요해서 목적이 다름). */
const SENTENCE_PATTERN = /[^.!?~]+[.!?~]*/g;

/**
 * 턴에 속한 세그먼트 텍스트를 순서대로 이어 붙인 뒤 문장부호로 쪼갠다. 각 문장이 원본의
 * 어느 세그먼트(들)에서 왔는지 문자 오프셋으로 추적해서 sourceSegments에 담는다 —
 * 그래야 문장 단위로 지적을 걸어도 항상 실제 세그먼트를 가리킬 수 있다.
 */
export function splitTurnIntoSentences(turn: Turn): Sentence[] {
  type Span = { segment: TranscriptSegment; start: number; end: number };

  let text = "";
  const spans: Span[] = [];
  for (const segment of turn.segments) {
    if (text.length > 0 && !/\s$/.test(text)) text += " ";
    const start = text.length;
    text += segment.text;
    spans.push({ segment, start, end: text.length });
  }

  const sentences: Sentence[] = [];
  for (const match of text.matchAll(SENTENCE_PATTERN)) {
    const sentenceText = match[0].trim();
    if (!sentenceText) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const sourceSegments = spans.filter((s) => s.start < end && s.end > start).map((s) => s.segment);
    sentences.push({
      text: sentenceText,
      sourceSegments: sourceSegments.length > 0 ? sourceSegments : turn.segments,
    });
  }

  return sentences;
}

/**
 * segmentIndex -> 그 세그먼트가 속한 턴의 "대표" 세그먼트 index(턴의 첫 세그먼트) 맵.
 * 같은 턴에 속한 질문 여럿을 하나로 묶어 볼 때(Q1 중복 제거 등) 쓴다.
 */
export function buildTurnKeyIndex(turns: Turn[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const turn of turns) {
    const key = turn.segments[0].index;
    for (const segment of turn.segments) map.set(segment.index, key);
  }
  return map;
}

/** segmentIndex -> 그 세그먼트가 속한 턴의 마지막 세그먼트 index 맵. Q5가 "같은 턴 안의
 *  다음 세그먼트"를 건너뛰고 턴이 실제로 끝나는 지점부터 대기 시간을 잴 때 쓴다. */
export function buildTurnEndIndex(turns: Turn[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const turn of turns) {
    const endIndex = turn.segments[turn.segments.length - 1].index;
    for (const segment of turn.segments) map.set(segment.index, endIndex);
  }
  return map;
}
