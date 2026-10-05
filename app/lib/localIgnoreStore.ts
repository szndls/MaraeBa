const KEY_PREFIX = "balmun:ignored:";

export function loadIgnoredIds(analysisName: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + analysisName);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveIgnoredIds(analysisName: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_PREFIX + analysisName, JSON.stringify(ids));
  } catch {
    // 저장 공간이 꽉 찼거나 비공개 모드 — 무시 상태가 다음 방문까지 유지되지 않을 뿐,
    // 화면 동작 자체는 계속 정상이어야 하므로 조용히 넘어간다.
  }
}
