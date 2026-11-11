/** "저장하기"를 누른 수업 이름 목록 — 서버 output/saved.json 대신 localStorage에 둔다. */
const KEY = "balmun:saved-names";

export function loadSavedNames(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isSavedName(name: string): boolean {
  return loadSavedNames().includes(name);
}

export function addSavedName(name: string): void {
  if (typeof window === "undefined") return;
  const names = loadSavedNames();
  if (names.includes(name)) return;
  names.push(name);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    // 저장 공간 문제로 다음 방문까지 유지 안 될 수 있으나, 화면 동작은 계속돼야 한다.
  }
}
