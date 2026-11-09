import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";
import { getOpenAIClient, getTranscribeModel } from "../llm/client.js";

/**
 * known_speaker_names/known_speaker_references로 등록하는 교사 화자 라벨. 요청과
 * 응답 매핑(loadTranscript.ts의 loadFromDiarizeResult)이 반드시 같은 문자열을 써야
 * 한다 — API가 등록한 이름을 그대로 돌려준다.
 */
export const TEACHER_SPEAKER_LABEL = "교사";

/** gpt-4o-transcribe-diarize 문서가 명시하는 업로드 파일 크기 한도 (whisper 계열과 동일) */
const MAX_AUDIO_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = AUDIO_MIME_TYPES[ext];
  if (!mime) {
    throw new Error(
      `지원하지 않는 오디오 형식입니다: "${ext}" (${filePath}). mp3/mp4/mpeg/mpga/m4a/wav/webm만 지원합니다.`
    );
  }
  return mime;
}

/**
 * known_speaker_references에 넣을 교사 목소리 샘플을 data URL로 인코딩한다.
 * OpenAI 문서 기준 2~10초 분량이어야 한다 — 더 길거나 짧으면 API가 에러를 낸다.
 */
async function buildKnownSpeakerReferenceDataUrl(filePath: string): Promise<string> {
  const mime = getAudioMimeType(filePath);
  const buffer = await readFile(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function assertUploadableSize(filePath: string): Promise<void> {
  const { size } = await stat(filePath);
  if (size > MAX_AUDIO_FILE_SIZE_BYTES) {
    const sizeMb = (size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `오디오 파일이 너무 큽니다: ${filePath} (${sizeMb}MB, 한도 25MB). ` +
        `긴 녹음은 아직 분할·압축을 지원하지 않습니다 — 더 짧은 파일로 테스트해 주세요.`
    );
  }
}

export interface TranscribeAudioOptions {
  audioFilePath: string;
  teacherSampleFilePath: string;
}

/**
 * gpt-4o-transcribe-diarize를 호출해서 원본 API 응답을 그대로 반환한다(매핑은
 * loadTranscript.ts의 loadFromDiarizeResult가 담당 — API 호출과 변환을 분리).
 *
 * 설치된 openai SDK(4.104.0) 타입 정의에는 known_speaker_names/known_speaker_references/
 * "diarized_json"이 아직 없다(최신 기능이라 타입이 못 따라옴) — 런타임 동작에는 문제가
 * 없으므로 요청 객체를 한 번 타입 단언한다.
 */
export async function transcribeAudio(options: TranscribeAudioOptions): Promise<unknown> {
  const { audioFilePath, teacherSampleFilePath } = options;

  await assertUploadableSize(audioFilePath);

  const client = getOpenAIClient();
  const knownSpeakerReference = await buildKnownSpeakerReferenceDataUrl(teacherSampleFilePath);

  const params = {
    file: fs.createReadStream(audioFilePath),
    model: getTranscribeModel(),
    response_format: "diarized_json",
    chunking_strategy: "auto",
    known_speaker_names: [TEACHER_SPEAKER_LABEL],
    known_speaker_references: [knownSpeakerReference],
  };

  // 오디오 변환은 텍스트 LLM 호출보다 오래 걸릴 수 있어 이 호출만 타임아웃을 늘린다
  // (재시도 1회는 클라이언트 기본값 그대로 — src/llm/client.ts 참고).
  return client.audio.transcriptions.create(params as any, { timeout: 600_000 });
}
