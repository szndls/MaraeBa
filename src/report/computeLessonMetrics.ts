import type { NormalizedTranscript } from "../types/transcript.js";
import type { ClassifiedQuestion, QuestioningFinding, ResponseEvent } from "../types/questioning.js";
import type { VocabFinding } from "../types/vocab.js";
import type { WaitTimeEvaluation } from "../questioning/checkWaitTime.js";
import type { ResponseProbingResult } from "../questioning/checkResponseHandling.js";
import type { MetricResult, GoodPoint, PriorityFix } from "../types/report.js";
import {
  getLessonMetric,
  extractPercent,
  extractAscendingPercentThresholds,
  isTemporaryCriteria,
} from "../criteria/loadLessonCriteria.js";
import { severityRank } from "../criteria/loadQuestioningCriteria.js";

function extractSeconds(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*초/);
  return match ? Number(match[1]) : null;
}

/** rule의 등급별 %문구에서 읽은 오름차순 경계값 [lower, upper]로 좋음/보통/개선 필요를 나눈다. */
function classifyByPercent(value: number, rule: Record<string, string>): "좋음" | "보통" | "개선 필요" {
  const [lower, upper] = extractAscendingPercentThresholds(rule);
  if (upper !== undefined && value >= upper) return "좋음";
  if (lower !== undefined && value >= lower) return "보통";
  return "개선 필요";
}

/** L1: 발문 유형 분포 — 확산적+평가적 비율 (합치는 유형 이름은 reference_range 키에서 그대로 읽는다) */
export function computeL1(questions: ClassifiedQuestion[]): MetricResult {
  const metric = getLessonMetric("L1");
  const rangeKey = Object.keys(metric.reference_range ?? {})[0] ?? "";
  const targetTypes = rangeKey.split("+").filter(Boolean);
  const threshold = extractPercent(metric.reference_range?.[rangeKey] ?? "");

  const total = questions.length;
  const targetQuestions = questions.filter((q) => targetTypes.includes(q.questionType));
  const percent = total === 0 ? 0 : (targetQuestions.length / total) * 100;

  let grade: "좋음" | "보통" | "개선 필요";
  if (targetQuestions.length === 0) {
    grade = "개선 필요";
  } else if (threshold !== null && percent >= threshold) {
    grade = "좋음";
  } else {
    grade = "보통";
  }

  return {
    id: "L1",
    name: metric.name,
    grade,
    detail: `전체 발문 ${total}개 중 ${targetTypes.join("·")} 발문 ${targetQuestions.length}개 (${percent.toFixed(0)}%)${
      threshold !== null ? ` — 참고 기준 ${threshold}%` : ""
    }`,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: targetQuestions.slice(0, 3).map((q) => q.segment.index),
  };
}

/** L2: 발문 후 대기 시간 (wait_time_1) — 평균과 "N초 이상" 비율. N은 metric.description에서 읽는다. */
export function computeL2(waitTimeEvaluations: WaitTimeEvaluation[]): MetricResult {
  const metric = getLessonMetric("L2");
  const thresholdSec = extractSeconds(metric.description) ?? 3;
  const rule = metric.rule as Record<string, string>;

  const withValue = waitTimeEvaluations.filter((e) => e.waitTimeSec !== null) as Array<
    WaitTimeEvaluation & { waitTimeSec: number }
  >;
  const total = withValue.length;
  const avg = total === 0 ? 0 : withValue.reduce((sum, e) => sum + e.waitTimeSec, 0) / total;
  const overCount = withValue.filter((e) => e.waitTimeSec >= thresholdSec).length;
  const percent = total === 0 ? 0 : (overCount / total) * 100;

  return {
    id: "L2",
    name: metric.name,
    grade: total === 0 ? null : classifyByPercent(percent, rule),
    detail:
      total === 0
        ? "학생 발화가 뒤따른 발문이 없어 계산할 수 없음"
        : `평균 대기 ${avg.toFixed(1)}초, ${total}건 중 ${thresholdSec}초 이상인 비율 ${percent.toFixed(0)}%`,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: withValue
      .filter((e) => e.waitTimeSec >= thresholdSec)
      .slice(0, 2)
      .map((e) => e.question.segment.index),
  };
}

/** L3: 학생 답 후 대기 시간 (wait_time_2) — responseEvents로 직접 계산한다(다른 단계 데이터 없음). */
export function computeL3(transcript: NormalizedTranscript, responseEvents: ResponseEvent[]): MetricResult {
  const metric = getLessonMetric("L3");
  const thresholdSec = extractSeconds(metric.description) ?? 3;
  const rule = metric.rule as Record<string, string>;

  const values: Array<{ seconds: number; studentSegmentIndex: number }> = [];
  for (const event of responseEvents) {
    const firstReply = event.responseWindowSegments[0] ?? event.nextQuestionSegment ?? null;
    if (!firstReply) continue;
    const seconds = Math.max(0, firstReply.start - event.studentSegment.end);
    values.push({ seconds, studentSegmentIndex: event.studentSegment.index });
  }

  const total = values.length;
  const avg = total === 0 ? 0 : values.reduce((sum, v) => sum + v.seconds, 0) / total;
  const overCount = values.filter((v) => v.seconds >= thresholdSec).length;
  const percent = total === 0 ? 0 : (overCount / total) * 100;

  return {
    id: "L3",
    name: metric.name,
    grade: total === 0 ? null : classifyByPercent(percent, rule),
    detail:
      total === 0
        ? "교사 반응이 뒤따른 학생 발화가 없어 계산할 수 없음"
        : `평균 대기 ${avg.toFixed(1)}초, ${total}건 중 ${thresholdSec}초 이상인 비율 ${percent.toFixed(0)}%`,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: values
      .filter((v) => v.seconds >= thresholdSec)
      .slice(0, 2)
      .map((v) => v.studentSegmentIndex),
  };
}

/** L4: 후속 발문(캐묻기) 비율 — checkResponseHandling이 이미 계산한 원자적 판정을 그대로 집계한다. */
export function computeL4(probingResults: ResponseProbingResult[]): MetricResult {
  const metric = getLessonMetric("L4");
  const rule = metric.rule as Record<string, string>;

  const withResponse = probingResults.filter((r) => r.hasResponseContent);
  const total = withResponse.length;
  const probingCount = withResponse.filter((r) => r.hasProbingInWindow).length;
  const percent = total === 0 ? 0 : (probingCount / total) * 100;

  return {
    id: "L4",
    name: metric.name,
    grade: total === 0 ? null : classifyByPercent(percent, rule),
    detail:
      total === 0
        ? "교사 반응이 있었던 학생 답변이 없어 계산할 수 없음"
        : `교사 반응 ${total}건 중 캐묻기(이유 묻기·되짚기·연결 등) ${probingCount}건 (${percent.toFixed(0)}%)`,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: withResponse
      .filter((r) => r.hasProbingInWindow)
      .slice(0, 2)
      .map((r) => r.studentSegmentIndex),
  };
}

/** L6: 4단계 지적 사항 집계 + 우선 개선 기준(priorityFixes) 산출.
 *  사용자 결정: 심각도(severityRank 내림차순) → 빈도(내림차순) 순으로 정렬하고,
 *  같은 기준은 한 번만 담는다. */
export function computeL6(
  questioningFindings: QuestioningFinding[]
): { metric: MetricResult; priorityFixes: PriorityFix[] } {
  const metric = getLessonMetric("L6");

  const byCriterion = new Map<string, QuestioningFinding[]>();
  for (const f of questioningFindings) {
    const list = byCriterion.get(f.criterionId) ?? [];
    list.push(f);
    byCriterion.set(f.criterionId, list);
  }

  const entries: PriorityFix[] = [...byCriterion.entries()].map(([criterionId, findings]) => {
    const worstSeverity = findings.reduce(
      (worst, f) => (severityRank(f.severity) > severityRank(worst) ? f.severity : worst),
      findings[0].severity
    );
    return {
      criterionId,
      criterionName: findings[0].criterionName,
      severity: worstSeverity,
      count: findings.length,
      // 서로 다른 발생 사례를 보여주기 위해, 사례마다 대표 발화(그 지적의 첫 세그먼트)
      // 하나씩만 뽑는다 — 한 사례의 여러 세그먼트를 다 넣으면 "다른 사례처럼" 보인다.
      exampleSegmentIndices: Array.from(new Set(findings.slice(0, 2).map((f) => f.segments[0].index))),
    };
  });

  entries.sort((a, b) => {
    const rankDiff = severityRank(b.severity) - severityRank(a.severity);
    if (rankDiff !== 0) return rankDiff;
    return b.count - a.count;
  });

  const priorityFixes = entries.slice(0, 3);

  return {
    metric: {
      id: "L6",
      name: metric.name,
      grade: null,
      detail: `지적 총 ${questioningFindings.length}건, 기준 ${byCriterion.size}종 — 우선 개선 기준은 별도 표 참고`,
      isTemporaryCriteria: isTemporaryCriteria(metric),
      evidenceSegmentIndices: [],
    },
    priorityFixes,
  };
}

/** L7: 진도상 모를 수 있는 용어 — "아직 모름 확정"이 1개 이상이면 개선 필요, 없으면 좋음. */
export function computeL7(vocabFindings: VocabFinding[]): MetricResult {
  const metric = getLessonMetric("L7");
  const certainUnknown = vocabFindings.filter((v) => v.category === "certain_unknown");

  return {
    id: "L7",
    name: metric.name,
    grade: certainUnknown.length >= 1 ? "개선 필요" : "좋음",
    detail:
      certainUnknown.length === 0
        ? "아직 모름 확정 용어 없음"
        : `아직 모름 확정 용어 ${certainUnknown.length}개: ${certainUnknown.map((v) => v.term).join(", ")}`,
    isTemporaryCriteria: isTemporaryCriteria(metric),
    evidenceSegmentIndices: certainUnknown.slice(0, 3).flatMap((v) => v.foundInSegments.map((s) => s.index)),
  };
}

/**
 * 코드로만 뽑는 "잘한 점" — LLM 판단이 아니라 이미 계산된 판정 결과(발문 유형,
 * 대기시간, 캐묻기 성공 사례)에서 근거 있는 사례를 고른다. 우선순위: 캐묻기 성공 >
 * 고차원 발문 사용 > 충분한 대기시간. 최대 2개.
 */
export function computeGoodPoints(
  questions: ClassifiedQuestion[],
  waitTimeEvaluations: WaitTimeEvaluation[],
  probingResults: ResponseProbingResult[],
  transcript: NormalizedTranscript
): GoodPoint[] {
  const points: GoodPoint[] = [];
  const l1Metric = getLessonMetric("L1");
  const rangeKey = Object.keys(l1Metric.reference_range ?? {})[0] ?? "";
  const targetTypes = rangeKey.split("+").filter(Boolean);
  const l2Metric = getLessonMetric("L2");
  const l2ThresholdSec = extractSeconds(l2Metric.description) ?? 3;

  const probingSuccess = probingResults.find((r) => r.hasResponseContent && r.hasProbingInWindow);
  if (probingSuccess) {
    const seg = transcript.segments[probingSuccess.studentSegmentIndex];
    points.push({
      text: `학생 답변 후 평가로 끝내지 않고 이유를 묻거나 되짚는 반응을 보인 사례가 있습니다 (학생 발화 [${probingSuccess.studentSegmentIndex}] "${seg?.text ?? ""}" 이후).`,
      segmentIndices: [probingSuccess.studentSegmentIndex],
    });
  }

  const highOrderQuestion = questions.find((q) => targetTypes.includes(q.questionType));
  if (highOrderQuestion) {
    points.push({
      text: `${highOrderQuestion.questionType} 발문을 사용했습니다: [${highOrderQuestion.segment.index}] "${highOrderQuestion.segment.text}"`,
      segmentIndices: [highOrderQuestion.segment.index],
    });
  }

  const goodWait = waitTimeEvaluations.find((e) => e.waitTimeSec !== null && e.waitTimeSec >= l2ThresholdSec);
  if (goodWait) {
    points.push({
      text: `발문 후 ${l2ThresholdSec}초 이상 충분히 기다린 사례가 있습니다: [${goodWait.question.segment.index}] "${goodWait.question.segment.text}" (대기 ${goodWait.waitTimeSec!.toFixed(1)}초)`,
      segmentIndices: [goodWait.question.segment.index],
    });
  }

  return points.slice(0, 2);
}
