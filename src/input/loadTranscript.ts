import { readFile } from "node:fs/promises";
import type { NormalizedTranscript, TranscriptSegment } from "../types/transcript.js";
import { TEACHER_SPEAKER_LABEL } from "./transcribeAudio.js";

export function validateGrade(grade: number): void {
  if (typeof grade !== "number" || Number.isNaN(grade) || grade < 1 || grade > 6) {
    throw new Error(
      `grade는 1~6 사이의 초등 학년이어야 합니다 (받은 값: ${grade}). 교사가 직접 입력한 학년을 넣어주세요.`
    );
  }
}

/**
 * sample-transcript.json 같은 synthetic 전사본 파일을 읽어서 표준 스키마로 변환한다.
 * 세그먼트에 index를 부여하는 것 외에는 그대로 통과시킨다.
 */
export async function loadFromSyntheticJson(filePath: string): Promise<NormalizedTranscript> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as {
    meta: NormalizedTranscript["meta"];
    segments: Array<Omit<TranscriptSegment, "index">>;
  };

  const segments: TranscriptSegment[] = parsed.segments.map((seg, index) => ({
    ...seg,
    index,
  }));

  validateGrade(parsed.meta.grade);

  return { meta: parsed.meta, segments };
}

interface RawDiarizedSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface RawDiarizedResponse {
  segments: RawDiarizedSegment[];
}

/**
 * gpt-4o-transcribe-diarize 응답이 아직 안정화되지 않은 최신 기능이라, 모양이 예상과
 * 다르면 바로 알 수 있도록 방어적으로 검증한다.
 */
function validateDiarizeResponse(rawApiResponse: unknown): RawDiarizedResponse {
  const response = rawApiResponse as Partial<RawDiarizedResponse> | null | undefined;
  if (!response || !Array.isArray(response.segments)) {
    throw new Error(
      "diarize API 응답 형태가 예상과 다릅니다 — { segments: [...] } 배열이 없습니다. " +
        `실제 응답: ${JSON.stringify(rawApiResponse)}`
    );
  }
  for (const [i, seg] of response.segments.entries()) {
    if (
      typeof seg.speaker !== "string" ||
      typeof seg.text !== "string" ||
      typeof seg.start !== "number" ||
      typeof seg.end !== "number"
    ) {
      throw new Error(
        `diarize API 응답의 segments[${i}]가 { speaker, text, start, end } 모양이 아닙니다: ${JSON.stringify(seg)}`
      );
    }
  }
  return response as RawDiarizedResponse;
}

/**
 * gpt-4o-transcribe-diarize(src/input/transcribeAudio.ts) 응답을 표준 스키마로 변환한다.
 * known_speaker_names로 등록한 TEACHER_SPEAKER_LABEL과 일치하는 화자만 "teacher"이고,
 * 나머지는 화자가 몇 명이든 전부 "student"다(학생은 기기를 쓰지 않으므로 개별 구분이
 * 필요 없다 — CLAUDE.md).
 */
export function loadFromDiarizeResult(rawApiResponse: unknown, grade: number): NormalizedTranscript {
  validateGrade(grade);
  const response = validateDiarizeResponse(rawApiResponse);

  const segments: TranscriptSegment[] = response.segments.map((seg, index) => ({
    index,
    speaker: seg.speaker === TEACHER_SPEAKER_LABEL ? "teacher" : "student",
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));

  return {
    meta: { grade, source: "gpt-4o-transcribe-diarize", time_unit: "seconds" },
    segments,
  };
}
