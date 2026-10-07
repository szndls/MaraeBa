import type { TranscriptSegment } from "./transcript.js";

export interface QuestionCandidate {
  segment: TranscriptSegment;
  questionMarkCount: number;
}

export interface ClassifiedQuestion {
  segment: TranscriptSegment;
  questionType: string;
  questionMarkCount: number;
}

export interface QuestioningFinding {
  criterionId: string;
  criterionName: string;
  severity: string;
  segments: TranscriptSegment[];
  /** 교사에게 보여줄 한 문장 — 코드 템플릿 + 원문 인용으로 만든다(LLM 원자적
   *  판단 문장을 그대로 이어 붙이지 않음). */
  reason: string;
  /** 개발용 — 이 지적을 만든 LLM 원자적 판단의 원문(여러 개면 " / "로 이어 붙임).
   *  화면에는 보여주지 않는다. Q5처럼 LLM 판단이 없는 지적은 없음. */
  devReason?: string;
  detect: "code" | "llm" | "code+llm";
  /** 이 지적이 속하는 발문의 세그먼트 index (5단계에서 발문별로 지적을 묶는 데 사용).
   *  직전 교사 발화가 없는 드문 경우에만 null. */
  targetQuestionIndex: number | null;
  /** Q6/Q7/Q8 한정: 고쳐야 할 교사 반응 발화의 세그먼트 index (보통 응답 구간의 첫 발화). */
  targetReactionSegmentIndex?: number | null;
  /** Q3 자문자답의 답변 발화에 걸린 Q4처럼, 원래 성립 위치와 다른 발문으로 옮겨 합쳐진
   *  경우에만 채워짐. 5단계 프롬프트가 이 지적을 별도로 다루지 않고 맥락에 녹이도록 안내한다. */
  mergeNote?: string;
}

export interface ResponseEvent {
  /** 학생 답이 응답한 직전 교사 발화 */
  precedingQuestionSegment: TranscriptSegment | null;
  studentSegment: TranscriptSegment;
  /** 학생 답 직후부터 "다음 교사 발문 직전"까지의 교사 발화들 (판정 대상) */
  responseWindowSegments: TranscriptSegment[];
  /** 참고용 다음 발문 — 캐묻기인지 새 주제 질문인지는 LLM이 판단 */
  nextQuestionSegment: TranscriptSegment | null;
}
