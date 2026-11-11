/** 분석 결과를 서버 output/ 대신 브라우저 IndexedDB에 저장한다. 브라우저 전용. */
import { openDatabase, promisifyRequest, promisifyTransaction } from "./indexedDb.client.js";
import type { AnalysisResult } from "../../src/types/analysis.js";

const DB_NAME = "balmun-lessons";
const STORE = "analyses";

interface StoredLesson {
  name: string;
  sourceFile: string;
  runAt: string;
  analysis: AnalysisResult;
}

export interface LessonListEntry {
  name: string;
  sourceFile: string;
  runAt: string;
}

function db(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, 1, (d) => {
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "name" });
  });
}

export async function saveLesson(name: string, analysis: AnalysisResult): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  const entry: StoredLesson = { name, sourceFile: analysis.sourceFile, runAt: analysis.runAt, analysis };
  tx.objectStore(STORE).put(entry);
  await promisifyTransaction(tx);
}

export async function getLesson(name: string): Promise<AnalysisResult | null> {
  if (typeof indexedDB === "undefined") return null;
  const d = await db();
  const tx = d.transaction(STORE, "readonly");
  const result = await promisifyRequest<StoredLesson | undefined>(tx.objectStore(STORE).get(name));
  return result?.analysis ?? null;
}

export async function listLessons(): Promise<LessonListEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  const d = await db();
  const tx = d.transaction(STORE, "readonly");
  const all = await promisifyRequest<StoredLesson[]>(tx.objectStore(STORE).getAll());
  return all
    .map(({ name, sourceFile, runAt }) => ({ name, sourceFile, runAt }))
    .sort((a, b) => b.runAt.localeCompare(a.runAt));
}
