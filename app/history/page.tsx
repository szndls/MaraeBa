"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listLessons, type LessonListEntry } from "../lib/lessonStore.client.js";
import { loadSavedNames } from "../lib/savedNames.client.js";

// 기록: "저장하기"를 누른 수업 목록 (브라우저 IndexedDB + localStorage 기준)
export default function HistoryPage() {
  const [items, setItems] = useState<LessonListEntry[] | null>(null);

  useEffect(() => {
    (async () => {
      const saved = new Set(loadSavedNames());
      const all = await listLessons();
      setItems(all.filter((a) => saved.has(a.name)));
    })();
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">기록</h1>
        <Link href="/" className="text-sm text-stone-500 hover:text-chalk">← 홈으로</Link>
      </div>
      {items === null ? (
        <div className="card p-10 text-center text-stone-400">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center text-stone-400">아직 저장한 수업이 없어요.</div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => (
            <li key={a.name}>
              <Link href={`/lesson/${a.name}`} className="card group flex items-center gap-4 p-4 transition hover:border-chalk/30 hover:shadow-md">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-chalk-soft text-lg">🎙️</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{new Date(a.runAt).toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" })} 수업</div>
                  <div className="truncate text-xs text-stone-400">{a.name}</div>
                </div>
                <span className="text-stone-300 group-hover:text-chalk">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
