/**
 * 표준 전사본(transcript) 스키마.
 *
 * 지금은 synthetic JSON(sample-transcript.json)을 그대로 읽어서 이 형태로 쓰지만,
 * 나중에 실제 음성 인식(gpt-4o-transcribe-diarize) 결과를 이 형태로 변환하는
 * 함수만 추가하면 분석 파이프라인(src/concept/*, src/vocab/* 등)은 그대로 재사용할 수 있다.
 * 즉 "입력 소스"와 "분석 로직" 사이의 경계가 이 타입.
 *
 * 이 앱은 수학 교과로 한정한다 (CLAUDE.md). 그래서 meta에 별도 subject 필드는 없다 —
 * 항상 수학이라는 전제가 앱 전역에 적용된다.
 */

export type Speaker = "teacher" | "student";

export interface TranscriptSegment {
  /** 세그먼트 내에서의 순번 (0-based). 분석 결과에서 세그먼트를 참조할 때 사용 */
  index: number;
  speaker: Speaker;
  /** 시작 시각 (초 단위) */
  start: number;
  /** 종료 시각 (초 단위) */
  end: number;
  text: string;
}

export interface TranscriptMeta {
  title?: string;
  /** 교사가 직접 입력한 학년 (1~6) */
  grade: number;
  /** 이 전사본의 출처. 나중에 실제 음성 인식 결과가 들어오면 "gpt-4o-transcribe-diarize" 등으로 표시 */
  source: "synthetic" | "gpt-4o-transcribe-diarize" | string;
  time_unit: "seconds";
}

export interface NormalizedTranscript {
  meta: TranscriptMeta;
  segments: TranscriptSegment[];
}
