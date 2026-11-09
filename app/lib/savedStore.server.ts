import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// "저장하기"를 누른 수업 이름 목록을 output/saved.json 한 파일에 보관한다.
// (분석 결과 파일 자체는 analysis-<이름>.json 으로 이미 남아 있고, 여기엔 이름만 적는다)
const savedFile = () => path.join(process.cwd(), "output", "saved.json");

export async function readSavedNames(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(savedFile(), "utf-8")) as string[];
  } catch {
    return [];
  }
}

export async function addSavedName(name: string): Promise<void> {
  const names = await readSavedNames();
  if (!names.includes(name)) names.push(name);
  await mkdir(path.dirname(savedFile()), { recursive: true });
  await writeFile(savedFile(), JSON.stringify(names, null, 2), "utf-8");
}
