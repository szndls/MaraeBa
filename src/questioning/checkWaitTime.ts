import type { NormalizedTranscript } from "../types/transcript.js";
import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import { getCriterion, getQuestionTypes, severityRank } from "../criteria/loadQuestioningCriteria.js";

interface ThresholdCondition {
  key: string;
  description: string;
  numbers: number[];
  mentionedTypes: string[];
}

/**
 * thresholds의 각 문구(예: "1.0초 ≤ wait_time_1 < 3.0초", "발문 유형이 확산적·평가적인데
 * wait_time_1 < 5.0초")를 파싱한다. 숫자는 문구에 있는 그대로 읽고, 발문 유형은 문구에
 * 실제로 언급된 유형 라벨만 추출한다 — 코드에 별도 수치나 유형을 하드코딩하지 않는다.
 */
function parseThresholds(thresholds: Record<string, string>): ThresholdCondition[] {
  const allTypes = getQuestionTypes();
  return Object.entries(thresholds).map(([key, description]) => {
    // "초" 앞의 숫자만 임계값으로 본다 ("wait_time_1"의 "1"처럼 무관한 숫자를 걸러내기 위함)
    const numbers = Array.from(description.matchAll(/(\d+(?:\.\d+)?)\s*초/g)).map((m) => Number(m[1]));
    const mentionedTypes = allTypes.filter((t) => description.includes(t));
    return { key, description, numbers, mentionedTypes };
  });
}

function conditionMatches(cond: ThresholdCondition, waitTimeSec: number, questionType: string): boolean {
  if (cond.mentionedTypes.length > 0 && !cond.mentionedTypes.includes(questionType)) return false;

  if (cond.numbers.length === 1) return waitTimeSec < cond.numbers[0];
  if (cond.numbers.length === 2) return waitTimeSec >= cond.numbers[0] && waitTimeSec < cond.numbers[1];

  throw new Error(
    `Q5 thresholds의 "${cond.key}" 문구에서 숫자를 ${cond.numbers.length}개 찾았습니다 (1개 또는 2개여야 함): "${cond.description}"`
  );
}

export function checkWaitTime(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[]
): QuestioningFinding[] {
  const criterion = getCriterion("Q5");
  if (!criterion.thresholds) {
    throw new Error("criteria/questioning-criteria.json의 Q5에 thresholds가 없습니다.");
  }
  const conditions = parseThresholds(criterion.thresholds);

  const findings: QuestioningFinding[] = [];

  for (const question of questions) {
    const nextSegment = transcript.segments[question.segment.index + 1];
    if (!nextSegment) continue; // 다음 발화 없음
    if (nextSegment.speaker !== "student") continue; // 교사면 Q3에서만 다룸 (exception)

    const waitTimeSec = Math.max(0, nextSegment.start - question.segment.end);
    const matched = conditions.filter((c) => conditionMatches(c, waitTimeSec, question.questionType));
    if (matched.length === 0) continue;

    // 여러 조건이 겹치면 가장 무거운 것 하나를 severity로 쓰고, 근거에는 전부 적는다
    const heaviest = matched.reduce((a, b) => (severityRank(b.key) > severityRank(a.key) ? b : a));

    const reasonParts = matched.map((c) => `${c.key}(${c.description})`);
    const reason = `대기 시간 ${waitTimeSec.toFixed(1)}초, 발문 유형 "${question.questionType}" — 해당 조건: ${reasonParts.join("; ")}`;

    findings.push({
      criterionId: "Q5",
      criterionName: criterion.name,
      severity: heaviest.key,
      segments: [question.segment, nextSegment],
      reason,
      detect: "code",
    });
  }

  return findings;
}
