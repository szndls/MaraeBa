"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { AnalysisResult } from "../../../src/types/analysis.js";
import { getLesson, saveLesson } from "../../lib/lessonStore.client.js";
import { isSavedName } from "../../lib/savedNames.client.js";
import { severityOrder } from "../../lib/severityOrder.client.js";
import { LessonView } from "./LessonView.js";

// 홈의 "예시 수업 보기"가 가리키는 고정 이름 — public/sample-analysis.json을 받아서
// 보여준다(처음 열 때 IndexedDB에도 저장해 둬서, 이후로는 다른 수업과 똑같이 동작한다).
const SAMPLE_LESSON_NAME = "sample-transcript";

type LoadState = { status: "loading" } | { status: "not-found" } | { status: "ready"; analysis: AnalysisResult };

export default function LessonPage() {
  const params = useParams<{ name: string }>();
  const name = params.name;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [initiallySaved, setInitiallySaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let analysis = await getLesson(name);
      if (!analysis && name === SAMPLE_LESSON_NAME) {
        try {
          const res = await fetch("/sample-analysis.json");
          if (res.ok) {
            analysis = (await res.json()) as AnalysisResult;
            await saveLesson(name, analysis);
          }
        } catch {
          // 네트워크 문제면 아래에서 notFound로 처리됨
        }
      }
      if (cancelled) return;
      setInitiallySaved(isSavedName(name));
      setState(analysis ? { status: "ready", analysis } : { status: "not-found" });
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (state.status === "loading") {
    return <main className="flex min-h-[60vh] items-center justify-center text-stone-400">불러오는 중…</main>;
  }

  if (state.status === "not-found") {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="text-xl font-bold">수업을 찾을 수 없어요</h1>
        <p className="mt-2 text-sm text-stone-500">이 기기에 저장된 분석 결과가 아니에요.</p>
        <Link href="/" className="mt-6 rounded-xl bg-chalk px-5 py-2.5 font-semibold text-white">홈으로</Link>
      </main>
    );
  }

  return <LessonView name={name} analysis={state.analysis} severityOrder={severityOrder} initiallySaved={initiallySaved} />;
}
