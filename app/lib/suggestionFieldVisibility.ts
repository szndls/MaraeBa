import type { SuggestionValidation } from "../../src/types/suggestion.js";

export interface SuggestionFieldVisibility {
  questionLine: boolean;
  hintLine: boolean;
  responseLine: boolean;
  action: boolean;
}

/**
 * ValidationOutcome의 세부 플래그를 그대로 노출하지 않고, 필드별로 "보여줄지 /
 * 검토 필요로 숨길지"만 판단한다. 코드 대체 대사로 이미 고쳐진 경우
 * (usedCodeReplacementResponseLine)는 responseLineRevisedOk/responseLineFirstPersonOk가
 * false로 남아있어도 정상 표시한다 — 실제로는 이미 안전한 문장으로 바뀌었기 때문.
 */
export function getSuggestionFieldVisibility(v: SuggestionValidation): SuggestionFieldVisibility {
  const questionLine = v.reclassifiedOk !== false && v.noAnswerLeakInQuestionOk && v.notCopiedOk;

  const hintLine = v.hintNotRestatementOk && v.noAnswerLeakInHintOk;

  const responseLineCoreOk =
    v.usedCodeReplacementResponseLine || (v.responseLineRevisedOk !== false && v.responseLineFirstPersonOk);
  const responseLine = responseLineCoreOk && v.noAnswerLeakOk;

  const action = v.actionScopeOk;

  return { questionLine, hintLine, responseLine, action };
}
