import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "../../src/types/analysis.js";

/** output/ 폴더는 항상 저장소 루트 기준 — 서버 전용(node:fs). 클라이언트 컴포넌트에서 import하지 말 것. */
function outputDir(): string {
  return path.join(process.cwd(), "output");
}

export function analysisFilePath(name: string): string {
  return path.join(outputDir(), `analysis-${name}.json`);
}

export async function readAnalysis(name: string): Promise<AnalysisResult | null> {
  try {
    const raw = await readFile(analysisFilePath(name), "utf-8");
    return JSON.parse(raw) as AnalysisResult;
  } catch {
    return null;
  }
}

export interface AnalysisListEntry {
  name: string;
  sourceFile: string;
  runAt: string;
}

/** output/analysis-*.json 전부를 가볍게 훑어서 목록 화면에 쓸 정보만 뽑는다. */
export async function listAnalyses(): Promise<AnalysisListEntry[]> {
  let files: string[];
  try {
    files = await readdir(outputDir());
  } catch {
    return [];
  }

  const entries: AnalysisListEntry[] = [];
  for (const file of files) {
    const match = file.match(/^analysis-(.+)\.json$/);
    if (!match) continue;
    const name = match[1];
    const analysis = await readAnalysis(name);
    if (!analysis) continue;
    entries.push({ name, sourceFile: analysis.sourceFile, runAt: analysis.runAt });
  }
  entries.sort((a, b) => b.runAt.localeCompare(a.runAt));
  return entries;
}
