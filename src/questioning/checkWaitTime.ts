import type { NormalizedTranscript, TranscriptSegment } from "../types/transcript.js";
import type { ClassifiedQuestion, QuestioningFinding } from "../types/questioning.js";
import { getCriterion, getQuestionTypes, severityRank } from "../criteria/loadQuestioningCriteria.js";

interface ThresholdCondition {
  condition: string;
  severity: string;
  description: string;
  numbers: number[];
  mentionedTypes: string[];
}

export interface WaitTimeEvaluation {
  question: ClassifiedQuestion;
  nextSegment: TranscriptSegment | null;
  /** null이면 대기시간을 계산하지 않은 경우 (다음 발화가 교사 → Q3에서만 다룸, 또는 다음 발화 없음) */
  waitTimeSec: number | null;
  skippedReason: string | null;
  matchedConditions: ThresholdCondition[];
  /** matchedConditions 중 가장 무거운 것의 key. 없으면 null(문제 없음) */
  severity: string | null;
}

/**
 * thresholds의 각 문구(예: "1.0초 ≤ wait_time_1 < 3.0초", "발문 유형이 확산적·평가적인데
 * wait_time_1 < 5.0초")를 파싱한다. 숫자는 문구에 있는 그대로 읽고, 발문 유형은 문구에
 * 실제로 언급된 유형 라벨만 추출한다 — 코드에 별도 수치나 유형을 하드코딩하지 않는다.
 */
function parseThresholds(
  thresholds: Array<{ condition: string; severity: string; description: string }>
): ThresholdCondition[] {
  const allTypes = getQuestionTypes();
  return thresholds.map(({ condition, severity, description }) => {
    // "초" 앞의 숫자만 임계값으로 본다 ("wait_time_1"의 "1"처럼 무관한 숫자를 걸러내기 위함)
    const numbers = Array.from(description.matchAll(/(\d+(?:\.\d+)?)\s*초/g)).map((m) => Number(m[1]));
    const mentionedTypes = allTypes.filter((t) => description.includes(t));
    return { condition, severity, description, numbers, mentionedTypes };
  });
}

function conditionMatches(cond: ThresholdCondition, waitTimeSec: number, questionType: string): boolean {
  if (cond.mentionedTypes.length > 0 && !cond.mentionedTypes.includes(questionType)) return false;

  if (cond.numbers.length === 1) return waitTimeSec < cond.numbers[0];
  if (cond.numbers.length === 2) return waitTimeSec >= cond.numbers[0] && waitTimeSec < cond.numbers[1];

  throw new Error(
    `Q5 thresholds의 "${cond.condition}" 문구에서 숫자를 ${cond.numbers.length}개 찾았습니다 (1개 또는 2개여야 함): "${cond.description}"`
  );
}

/** 발문 전체에 대한 대기시간 평가 목록을 만든다 (지적 여부와 무관하게 전부 포함) */
export function evaluateWaitTimes(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[]
): WaitTimeEvaluation[] {
  const criterion = getCriterion("Q5");
  if (!criterion.thresholds) {
    throw new Error("criteria/questioning-criteria.json의 Q5에 thresholds가 없습니다.");
  }
  const conditions = parseThresholds(criterion.thresholds);

  return questions.map((question) => {
    const nextSegment = transcript.segments[question.segment.index + 1] ?? null;

    if (!nextSegment) {
      return {
        question,
        nextSegment: null,
        waitTimeSec: null,
        skippedReason: "다음 발화 없음(수업의 마지막 발화)",
        matchedConditions: [],
        severity: null,
      };
    }
    if (nextSegment.speaker !== "student") {
      return {
        question,
        nextSegment,
        waitTimeSec: null,
        skippedReason: "다음 발화가 교사 — Q3(자문자답)에서만 다룸",
        matchedConditions: [],
        severity: null,
      };
    }

    const waitTimeSec = Math.max(0, nextSegment.start - question.segment.end);
    const matched = conditions.filter((c) => conditionMatches(c, waitTimeSec, question.questionType));
    const severity =
      matched.length === 0
        ? null
        : matched.reduce((a, b) => (severityRank(b.severity) > severityRank(a.severity) ? b : a)).severity;

    return { question, nextSegment, waitTimeSec, skippedReason: null, matchedConditions: matched, severity };
  });
}

/**
 * 발문 유형에 대해 "지적이 완전히 사라지는" 목표 대기시간(초)을 계산한다. 이 발문
 * 유형에 적용되는 모든 조건의 상한값(각 조건의 마지막 숫자) 중 가장 큰 값을 목표로
 * 삼는다. 예: 일반 발문은 개선권장 조건의 상한(3.0초)까지, 확산적·평가적 발문은
 * 고차원 조건의 상한(5.0초)까지 — 그래야 그 유형에 걸리는 모든 조건을 한꺼번에
 * 벗어난다. 5단계(Q3 힌트 발문 대기시간 등)에서도 재사용한다.
 */
export function computeTargetWaitSeconds(questionType: string): number | null {
  const criterion = getCriterion("Q5");
  if (!criterion.thresholds) return null;
  const conditions = parseThresholds(criterion.thresholds);

  const applicable = conditions.filter(
    (c) => c.mentionedTypes.length === 0 || c.mentionedTypes.includes(questionType)
  );
  const upperBounds = applicable
    .map((c) => c.numbers[c.numbers.length - 1])
    .filter((n): n is number => n !== undefined);
  if (upperBounds.length === 0) return null;

  return Math.max(...upperBounds);
}

/**
 * Q5 지적에 대한 "몇 초 더 기다릴지" 조언을 코드로 계산한다 (LLM이 숫자를 지어내지 않도록).
 * 단순히 "현재 값보다 큰 최소 경계값"을 쓰면(예: 0.6초 → 1.0초) 여전히 다른 조건
 * (개선 권장)에 걸린 채로 남으므로, computeTargetWaitSeconds로 완전히 벗어나는 값을 쓴다.
 */
export function computeWaitTimeAdvice(evaluation: WaitTimeEvaluation): string | null {
  if (evaluation.waitTimeSec === null || evaluation.severity === null) return null;

  const target = computeTargetWaitSeconds(evaluation.question.questionType);
  if (target === null) return null;

  return `발문 후 최소 ${target.toFixed(1)}초 이상 기다려 주세요 (지금 관찰된 대기 시간: ${evaluation.waitTimeSec.toFixed(1)}초).`;
}

export function checkWaitTime(
  transcript: NormalizedTranscript,
  questions: ClassifiedQuestion[]
): QuestioningFinding[] {
  const criterion = getCriterion("Q5");
  const evaluations = evaluateWaitTimes(transcript, questions);

  return evaluations
    .filter((e) => e.severity !== null && e.nextSegment !== null && e.waitTimeSec !== null)
    .map((e) => {
      const reasonParts = e.matchedConditions.map((c) => `${c.condition}(${c.description})`);
      const reason = `대기 시간 ${e.waitTimeSec!.toFixed(1)}초, 발문 유형 "${e.question.questionType}" — 해당 조건: ${reasonParts.join("; ")}`;

      return {
        criterionId: "Q5",
        criterionName: criterion.name,
        severity: e.severity!,
        segments: [e.question.segment, e.nextSegment!],
        reason,
        detect: "code" as const,
        targetQuestionIndex: e.question.segment.index,
      };
    });
}
