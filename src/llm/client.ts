import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY가 설정되지 않았습니다. .env.local 파일을 만들고 키를 넣어주세요 (.env.local.example 참고)."
      );
    }
    // 기본 타임아웃(10분)·기본 재시도(2회)로는 네트워크가 불안정할 때 호출 하나가
    // 수십 분씩 멈춰 있을 수 있다(실측 확인됨) — 60초로 줄이고 재시도는 1회만 허용해서,
    // 멈추지 않고 비교적 빨리 실패하도록 한다.
    client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });
  }
  return client;
}

export function getAnalysisModel(): string {
  return process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o-mini";
}
