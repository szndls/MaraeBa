import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFromSyntheticJson } from "./input/loadTranscript.js";
import { matchConcept } from "./concept/matchConcept.js";
import { detectKnownTerms } from "./vocab/detectKnownTerms.js";
import { detectHardWords } from "./vocab/detectHardWords.js";
import type { VocabFinding } from "./types/vocab.js";
import { extractQuestionCandidates } from "./questioning/extractQuestions.js";
import { classifyAndCheckQuestions } from "./questioning/classifyAndCheckQuestions.js";
import { checkSelfAnswer } from "./questioning/checkSelfAnswer.js";
import { checkWaitTime } from "./questioning/checkWaitTime.js";
import { extractResponseEvents } from "./questioning/extractResponseEvents.js";
import { checkResponseHandling } from "./questioning/checkResponseHandling.js";
import type { QuestioningFinding } from "./types/questioning.js";

loadEnv({ path: ".env.local" });

const outputDir = () => path.resolve(process.cwd(), "output");
const intermediateDir = () => path.join(outputDir(), "intermediate");

async function writeIntermediate(fileName: string, data: unknown) {
  await mkdir(intermediateDir(), { recursive: true });
  await writeFile(path.join(intermediateDir(), fileName), JSON.stringify(data, null, 2), "utf-8");
}

async function main() {
  const sourceFile = process.argv[2] || "sample-transcript.json";
  const sourcePath = path.resolve(process.cwd(), sourceFile);

  console.log(`[0단계] 학년 입력값 확인 + [1단계] 입력 정규화: ${sourceFile}`);
  const transcript = await loadFromSyntheticJson(sourcePath);
  console.log(`  → 학년: ${transcript.meta.grade}, 세그먼트 ${transcript.segments.length}개`);
  await writeIntermediate("01-transcript.json", transcript);

  console.log("[2단계] 개념 추측 + 성취기준 연결 (LLM)");
  const conceptMatch = await matchConcept(transcript);
  await writeIntermediate("02-concept-match.json", conceptMatch);

  console.log("\n=== 2단계 결과 ===");
  console.log(`학년군: ${conceptMatch.band} (${conceptMatch.grade}학년)`);
  console.log(`영역: ${conceptMatch.areaName}`);
  console.log(`성취기준: ${conceptMatch.standardCode} — ${conceptMatch.standardSummary}`);
  console.log(`판단 근거: ${conceptMatch.rationale}`);
  console.log("근거 발화:");
  for (const seg of conceptMatch.evidenceSegments) {
    console.log(`  [${seg.index}] "${seg.text}"`);
  }
  console.log("\n[3단계] 용어 탐지 (코드: 목록 대조 / LLM: 목록 외 어려운 어휘)");
  const knownTermFindings = detectKnownTerms(transcript, conceptMatch);
  const hardWordFindings = await detectHardWords(transcript, transcript.meta.grade);
  const vocabFindings: VocabFinding[] = [...knownTermFindings, ...hardWordFindings];
  await writeIntermediate("03-vocab-findings.json", vocabFindings);

  console.log("\n=== 3단계 결과 ===");
  printVocabGroup(vocabFindings, "certain_unknown", "아직 모름 확정");
  printVocabGroup(vocabFindings, "maybe_unknown", "아직 모를 수 있음");
  printVocabGroup(vocabFindings, "unlisted_hard_word", "목록에 없는 어려운 어휘");

  console.log("\n[4단계] 발문 지적사항 탐지");
  const candidates = extractQuestionCandidates(transcript);
  console.log(`  → 발문 후보(물음표/의문형 어미) ${candidates.length}개`);
  const { questions, findings: questionLevelFindings } = await classifyAndCheckQuestions(candidates);
  console.log(`  → 발문으로 확인됨 ${questions.length}개 (나머지는 발문 아님으로 제외)`);

  const q3Findings = await checkSelfAnswer(transcript, questions);
  const q5Findings = checkWaitTime(transcript, questions);
  const responseEvents = extractResponseEvents(transcript);
  const q678Findings = await checkResponseHandling(responseEvents);

  const questioningFindings: QuestioningFinding[] = [
    ...questionLevelFindings,
    ...q3Findings,
    ...q5Findings,
    ...q678Findings,
  ];

  await writeIntermediate("04-questions.json", questions);
  await writeIntermediate("04-questioning-findings.json", questioningFindings);

  console.log("\n=== 4단계 결과 ===");
  console.log("발문 유형 분류:");
  for (const q of questions) {
    console.log(`  [${q.segment.index}] (${q.questionType}) "${q.segment.text}"`);
  }
  console.log(`\n지적사항 총 ${questioningFindings.length}건`);
  for (const id of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"]) {
    printQuestioningGroup(questioningFindings, id);
  }

  console.log(`\n중간 결과 저장 위치: ${intermediateDir()}`);
}

function printVocabGroup(findings: VocabFinding[], category: VocabFinding["category"], label: string) {
  const group = findings.filter((f) => f.category === category);
  console.log(`\n[${label}] ${group.length}개`);
  for (const f of group) {
    const segIndices = f.foundInSegments.map((s) => s.index).join(", ");
    console.log(`  - "${f.term}" (세그먼트 ${segIndices}) — ${f.reason}`);
  }
}

function printQuestioningGroup(findings: QuestioningFinding[], criterionId: string) {
  const group = findings.filter((f) => f.criterionId === criterionId);
  if (group.length === 0) return;
  console.log(`\n[${criterionId} ${group[0].criterionName}] ${group.length}건`);
  for (const f of group) {
    const segInfo = f.segments.map((s) => `[${s.index}] "${s.text}"`).join(" → ");
    console.log(`  - (${f.severity}) ${segInfo}`);
    console.log(`    이유: ${f.reason}`);
  }
}

main().catch((err) => {
  console.error("분석 중 오류가 발생했습니다:", err);
  process.exit(1);
});
