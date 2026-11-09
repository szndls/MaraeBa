import type { NormalizedTranscript } from "../types/transcript.js";
import type { QuestionCandidate } from "../types/questioning.js";
import { getQuestionCandidateEndings, getTurnMergeGapSec } from "../criteria/loadQuestioningCriteria.js";
import { buildTurns, splitTurnIntoSentences } from "./reconstructUtterances.js";

/**
 * 실제 STT 결과에는 물음표가 빠질 수 있어서, 물음표뿐 아니라 의문형 어미로 끝나는
 * 교사 발화도 후보로 잡는다. 어미 목록은 criteria/questioning-criteria.json의
 * question_candidate_endings에서 읽어온다 — 여기서는 "후보"만 넓게 잡고, 진짜 발문인지는
 * classifyAndCheckQuestions의 LLM 확인 단계에서 최종 판정한다 (발문 아니면 결과에서 제외).
 *
 * 교사 턴(같은 화자가 짧은 간격으로 이어 말한 세그먼트 묶음, reconstructUtterances.ts)을
 * 먼저 만들고 그 안을 문장 단위로 쪼개서 후보를 찾는다 — STT가 한 호흡을 임의로 여러
 * 세그먼트로 쪼개도(예: "그중에 얼마일까요?"와 "그리고 뭐가 더 커요?"가 따로 STT됨)
 * 턴으로 다시 묶여서 겹질문(Q1) 신호가 살아난다.
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
  const gapSec = getTurnMergeGapSec();
  const turns = buildTurns(transcript.segments, gapSec);

  const candidates: QuestionCandidate[] = [];

  for (const turn of turns) {
    if (turn.speaker !== "teacher") continue;

    for (const sentence of splitTurnIntoSentences(turn)) {
      const questionMarkCount = (sentence.text.match(/\?/g) ?? []).length;
      const isCandidate = questionMarkCount > 0 || endsWithQuestionPattern(sentence.text, endings);
      if (!isCandidate) continue;

      candidates.push({
        segment: sentence.sourceSegments[0],
        text: sentence.text,
        turnSegments: turn.segments,
        questionMarkCount,
      });
    }
  }

  return candidates;
}
