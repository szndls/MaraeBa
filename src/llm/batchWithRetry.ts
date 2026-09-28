/**
 * LLM 배치 호출 공용 유틸.
 * - 요청에 없던 id를 응답이 반환하면(할루시네이션) 버린다.
 * - 요청했는데 응답에 없는 id가 있으면 그 id만 한 번 재요청한다.
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

  applyResults(await requestFn(items));

  const missingIds = items.map((i) => i.id).filter((id) => !resultMap.has(id));
  if (missingIds.length > 0) {
    console.warn(`[${label}] id(${missingIds.join(", ")})가 누락되어 재요청합니다.`);
    const retryItems = items.filter((i) => missingIds.includes(i.id));
    applyResults(await requestFn(retryItems));

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
 * requestBatchWithRetry를 작은 묶음(chunkSize)으로 나눠서 순차 호출한다.
 * 한 번에 너무 많은 사례를 넣으면 LLM이 reason을 비우거나 flag를 과도하게
 * true로 내는 품질 저하가 관찰되어(특히 사례당 필드가 많은 경우), 묶음을 작게 유지한다.
 */
export async function requestBatchInChunks<TInput extends { id: number }, TResult extends { id: number }>(
  items: TInput[],
  chunkSize: number,
  requestFn: (batch: TInput[]) => Promise<TResult[]>,
  label: string
): Promise<Map<number, TResult>> {
  const merged = new Map<number, TResult>();
  for (const chunk of chunkArray(items, chunkSize)) {
    const chunkResult = await requestBatchWithRetry(chunk, requestFn, label);
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
