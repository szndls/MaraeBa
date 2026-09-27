import type { NormalizedTranscript, TranscriptSegment } from "../types/transcript.js";
import type { ResponseEvent } from "../types/questioning.js";

/**
 * 학생 발화마다: 직전의 교사 발화(무엇에 답한 것인지, Q7에서 오답 여부 판단에 필요)와
 * 그 뒤 이어지는 연속된 교사 발화들(응답 구간, Q6/Q7/Q8 판정 대상)을 묶는다.
 * 응답 구간은 다음 학생 발화가 나오기 전까지의 교사 발화를 전부 포함한다
 * (교사가 "맞아요" 하나로 끝내지 않고 여러 문장에 걸쳐 반응하는 경우를 놓치지 않기 위함).
 */
export function extractResponseEvents(transcript: NormalizedTranscript): ResponseEvent[] {
  const { segments } = transcript;

  return segments
    .filter((s) => s.speaker === "student")
    .map((studentSegment) => {
      const precedingQuestionSegment = findPrecedingTeacherSegment(segments, studentSegment.index);
      const responseWindowSegments = collectFollowingTeacherSegments(segments, studentSegment.index);
      return { precedingQuestionSegment, studentSegment, responseWindowSegments };
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

function collectFollowingTeacherSegments(
  segments: TranscriptSegment[],
  fromIndex: number
): TranscriptSegment[] {
  const window: TranscriptSegment[] = [];
  for (let i = fromIndex + 1; i < segments.length; i++) {
    if (segments[i].speaker !== "teacher") break;
    window.push(segments[i]);
  }
  return window;
}
