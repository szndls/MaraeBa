import { readFile } from "node:fs/promises";
import type { NormalizedTranscript, TranscriptSegment } from "../types/transcript.js";

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

  validateMeta(parsed.meta);

  return { meta: parsed.meta, segments };
}

function validateMeta(meta: NormalizedTranscript["meta"]) {
  if (typeof meta.grade !== "number" || meta.grade < 1 || meta.grade > 6) {
    throw new Error(
      `meta.grade는 1~6 사이의 초등 학년이어야 합니다 (받은 값: ${meta.grade}). 교사가 직접 입력한 학년을 넣어주세요.`
    );
  }
}

/**
 * 나중에 실제 음성 인식(gpt-4o-transcribe-diarize) 결과를 여기서 표준 스키마로 변환한다.
 * 지금은 아직 녹음 파일/API 응답이 없으므로 자리만 잡아둔다.
 * 구현 시점에는 diarize API의 응답 형태(화자 라벨, 타임스탬프 단위 등)에 맞춰 매핑하면 된다.
 */
export function loadFromDiarizeResult(_rawApiResponse: unknown): NormalizedTranscript {
  throw new Error(
    "아직 구현되지 않음: gpt-4o-transcribe-diarize 응답을 NormalizedTranscript로 변환하는 어댑터를 추가하세요."
  );
}
