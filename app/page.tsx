import Link from "next/link";
import { listAnalyses } from "./lib/analysisStore.server.js";

export default async function Home() {
  const analyses = await listAnalyses();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">발문 코치</h1>
      <p className="mb-6 text-sm text-slate-500">저장된 분석 결과를 골라서 확인하세요.</p>

      {analyses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
          아직 분석 결과가 없어요. <code className="rounded bg-slate-100 px-1 py-0.5">npm run analyze -- 전사본.json</code>을
          먼저 실행해 주세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {analyses.map((a) => (
            <li key={a.name}>
              <Link
                href={`/lesson/${a.name}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="font-medium text-slate-700">{a.sourceFile}</div>
                <div className="text-xs text-slate-400">{new Date(a.runAt).toLocaleString("ko-KR")}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
