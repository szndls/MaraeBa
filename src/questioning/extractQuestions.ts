import type { NormalizedTranscript } from "../types/transcript.js";
import type { QuestionCandidate } from "../types/questioning.js";
import { getQuestionCandidateEndings } from "../criteria/loadQuestioningCriteria.js";

/**
 * 실제 STT 결과에는 물음표가 빠질 수 있어서, 물음표뿐 아니라 의문형 어미로 끝나는
 * 교사 발화도 후보로 잡는다. 어미 목록은 criteria/questioning-criteria.json의
 * question_candidate_endings에서 읽어온다 — 여기서는 "후보"만 넓게 잡고, 진짜 발문인지는
 * classifyAndCheckQuestions의 LLM 확인 단계에서 최종 판정한다 (발문 아니면 결과에서 제외).
 */
function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/["'”’」』.!?~…\s]+$/u, "");
}

function endsWithQuestionPattern(text: string, endings: string[]): boolean {
  const stripped = stripTrailingPunctuation(text);
  return endings.some((p) => stripped.endsWith(p));
}

export function extractQuestionCandidates(transcript: NormalizedTranscript): QuestionCandidate[] {
  const endings = getQuestionCandidateEndings();
  const candidates: QuestionCandidate[] = [];

  for (const segment of transcript.segments) {
    if (segment.speaker !== "teacher") continue;

    const questionMarkCount = (segment.text.match(/\?/g) ?? []).length;
    const isCandidate = questionMarkCount > 0 || endsWithQuestionPattern(segment.text, endings);

    if (isCandidate) {
      candidates.push({ segment, questionMarkCount });
    }
  }

  return candidates;
}
