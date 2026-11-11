import { getBatchConcurrency } from "./client.js";

/**
 * 속도 제한(429)에 걸리면 잠깐 기다렸다 같은 요청을 다시 보낸다. 서버가 Retry-After
 * 헤더를 주면 그만큼, 안 주면 점점 늘어나는 시간(지수 백오프)만큼 기다린다.
 * 429가 아닌 에러(네트워크 끊김 등)는 그대로 던진다 — 그건 이 함수가 다룰 문제가 아니다.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status !== 429 || attempt >= maxAttempts) throw err;

      const headers = (err as { headers?: { get?(name: string): string | null } } | null)?.headers;
      const retryAfterSec = Number(headers?.get?.("retry-after"));
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 1000 * 2 ** attempt;

      console.warn(`[속도 제한] 429 응답 — ${waitMs}ms 기다린 뒤 재시도 (시도 ${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * 공유 큐에서 다음 항목을 가져가는 일꾼(worker)을 limit개 동시에 돌린다. 결과는
 * 원래 순서(items와 같은 index)로 채워진다 — 처리 순서가 섞여도 최종 배열 순서는 그대로다.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * LLM 배치 호출 공용 유틸.
 * - 요청에 없던 id를 응답이 반환하면(할루시네이션) 버린다.
 * - 요청했는데 응답에 없는 id가 있으면 그 id만 한 번 재요청한다.
 * - 429(속도 제한)를 만나면 잠깐 기다렸다 재시도한다.
 * 여러 단계(발문 분류, 자문자답 확인, 응답구간 판정)에서 같은 패턴이 반복되어 공통화했다.
 */
export async function requestBatchWithRetry<TInput extends { id: number }, TResult extends { id: number }>(
  items: TInput[],
  requestFn: (batch: TInput[]) => Promise<TResult[]>,
  label: string
): Promise<Map<number, TResult>> {
  const validIds = new Set(items.map((i) => i.id));
  const resultMap = new Map<number, TResult>();

  const applyResults = (results: TResult[]) => {
    for (const r of results) {
      if (!validIds.has(r.id)) {
        console.warn(`[${label}] 요청하지 않은 id(${r.id})가 응답에 포함되어 무시합니다.`);
        continue;
      }
      resultMap.set(r.id, r);
    }
  };

  applyResults(await withRateLimitRetry(() => requestFn(items)));

  const missingIds = items.map((i) => i.id).filter((id) => !resultMap.has(id));
  if (missingIds.length > 0) {
    console.warn(`[${label}] id(${missingIds.join(", ")})가 누락되어 재요청합니다.`);
    const retryItems = items.filter((i) => missingIds.includes(i.id));
    applyResults(await withRateLimitRetry(() => requestFn(retryItems)));

    const stillMissing = missingIds.filter((id) => !resultMap.has(id));
    if (stillMissing.length > 0) {
      console.warn(`[${label}] 재요청 후에도 id(${stillMissing.join(", ")})가 누락되었습니다.`);
    }
  }

  return resultMap;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * requestBatchWithRetry를 작은 묶음(chunkSize)으로 나눠서, 묶음끼리는 동시에
 * concurrency개까지 병렬로 호출한다(기본값은 getBatchConcurrency() — 환경변수
 * OPENAI_BATCH_CONCURRENCY, 없으면 6). 묶음 "안" 사례 수(chunkSize)는 그대로
 * 유지한다 — 한 번에 너무 많은 사례를 넣으면 LLM이 reason을 비우거나 flag를
 * 과도하게 true로 내는 품질 저하가 관찰되었다(특히 사례당 필드가 많은 경우).
 * 병렬로 도는 건 "묶음 개수"이지 "묶음 크기"가 아니라서 이 품질 문제와는 무관하다.
 */
export async function requestBatchInChunks<TInput extends { id: number }, TResult extends { id: number }>(
  items: TInput[],
  chunkSize: number,
  requestFn: (batch: TInput[]) => Promise<TResult[]>,
  label: string,
  concurrency: number = getBatchConcurrency()
): Promise<Map<number, TResult>> {
  const chunks = chunkArray(items, chunkSize);
  const chunkResults = await mapWithConcurrency(chunks, concurrency, (chunk) =>
    requestBatchWithRetry(chunk, requestFn, label)
  );

  const merged = new Map<number, TResult>();
  for (const chunkResult of chunkResults) {
    for (const [id, value] of chunkResult) merged.set(id, value);
  }
  return merged;
}

/** 배열 형태의 인덱스 값 중, 실제로 존재하는 id 집합에 없는 값을 걸러낸다 */
export function filterValidIndices(indices: number[], validIds: Set<number>, label: string): number[] {
  const valid = indices.filter((i) => validIds.has(i));
  const invalid = indices.filter((i) => !validIds.has(i));
  if (invalid.length > 0) {
    console.warn(`[${label}] 존재하지 않는 세그먼트 index(${invalid.join(", ")})를 무시합니다.`);
  }
  return valid;
}
