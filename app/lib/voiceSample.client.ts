/** 교사 목소리 샘플(8초)을 서버 대신 브라우저 IndexedDB에 저장한다. 브라우저 전용. */
import { openDatabase, promisifyRequest, promisifyTransaction } from "./indexedDb.client.js";

const DB_NAME = "balmun-voice";
const STORE = "sample";
const KEY = "current";

function db(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, 1, (d) => {
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
  });
}

export async function hasVoiceSample(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  const d = await db();
  const tx = d.transaction(STORE, "readonly");
  const result = await promisifyRequest(tx.objectStore(STORE).get(KEY));
  return result != null;
}

export async function getVoiceSampleBlob(): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  const d = await db();
  const tx = d.transaction(STORE, "readonly");
  const result = await promisifyRequest<Blob | undefined>(tx.objectStore(STORE).get(KEY));
  return result ?? null;
}

export async function saveVoiceSample(blob: Blob): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(blob, KEY);
  await promisifyTransaction(tx);
}

export async function clearVoiceSample(): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(KEY);
  await promisifyTransaction(tx);
}
