import type { NormalizedTranscript, TranscriptSegment } from "../types/transcript.js";
import type { ResponseEvent } from "../types/questioning.js";

/**
 * 학생 발화마다: 직전의 교사 발화(무엇에 답한 것인지, Q7에서 오답 여부 판단에 필요)와
 * 그 뒤 "다음 교사 발문 직전까지"의 교사 발화(응답 구간)를 묶는다.
 * 다음 교사 발문 자체는 판정 대상(responseWindowSegments)에 넣지 않고 참고용으로만
 * 따로 넘긴다 — 그게 이 학생 답에 대한 캐묻기(이유 묻기·되짚기·다른 학생 연결)인지,
 * 완전히 새 주제의 질문인지는 LLM이 맥락으로 판단한다 (Q6 예외 판단에 필요).
 */
export function extractResponseEvents(
  transcript: NormalizedTranscript,
  confirmedQuestionIndices: Set<number>
): ResponseEvent[] {
  const { segments } = transcript;

  return segments
    .filter((s) => s.speaker === "student")
    .map((studentSegment) => {
      const precedingQuestionSegment = findPrecedingTeacherSegment(segments, studentSegment.index);
      const { responseWindowSegments, nextQuestionSegment } = collectUntilNextQuestion(
        segments,
        studentSegment.index,
        confirmedQuestionIndices
      );
      return { precedingQuestionSegment, studentSegment, responseWindowSegments, nextQuestionSegment };
    });
}

function findPrecedingTeacherSegment(
  segments: TranscriptSegment[],
  fromIndex: number
): TranscriptSegment | null {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (segments[i].speaker === "teacher") return segments[i];
  }
  return null;
}

function collectUntilNextQuestion(
  segments: TranscriptSegment[],
  fromIndex: number,
  confirmedQuestionIndices: Set<number>
): { responseWindowSegments: TranscriptSegment[]; nextQuestionSegment: TranscriptSegment | null } {
  const window: TranscriptSegment[] = [];

  for (let i = fromIndex + 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.speaker !== "teacher") break; // 다음 학생 발화 전까지만

    if (confirmedQuestionIndices.has(seg.index)) {
      return { responseWindowSegments: window, nextQuestionSegment: seg };
    }
    window.push(seg);
  }

  return { responseWindowSegments: window, nextQuestionSegment: null };
}
