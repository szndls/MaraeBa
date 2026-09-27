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
    client = new OpenAI({ apiKey });
  }
  return client;
}

export function getAnalysisModel(): string {
  return process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o-mini";
}
