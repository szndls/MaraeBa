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
import { checkWaitTime, evaluateWaitTimes } from "./questioning/checkWaitTime.js";
import { extractResponseEvents } from "./questioning/extractResponseEvents.js";
import { checkResponseHandling } from "./questioning/checkResponseHandling.js";
import type { QuestioningFinding } from "./types/questioning.js";
import { generateImprovements, VALIDATION_CATEGORY_LABELS } from "./suggestions/generateImprovements.js";
import { generateLessonReport } from "./report/generateLessonReport.js";

loadEnv({ path: ".env.local" });

const outputDir = () => path.resolve(process.cwd(), "output");
const intermediateDir = () => path.join(outputDir(), "intermediate");
const stabilityDir = () => path.join(outputDir(), "stability");

async function writeIntermediate(fileName: string, data: unknown) {
  await mkdir(intermediateDir(), { recursive: true });
  await writeFile(path.join(intermediateDir(), fileName), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 반복 실행 결과를 전사본별·회차별로 남겨서 덮어쓰지 않게 한다. 판정이 실행마다
 * 얼마나 흔들리는지(또는 안 흔들리는지) 나중에 근거로 보여줄 때 쓴다.
 */
async function writeStabilitySnapshot(sourceFile: string, data: unknown) {
  const transcriptName = path.basename(sourceFile, path.extname(sourceFile));
  const dir = path.join(stabilityDir(), transcriptName);
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(dir, `run-${timestamp}.json`), JSON.stringify(data, null, 2), "utf-8");
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
  const waitTimeEvaluations = evaluateWaitTimes(transcript, questions);
  const confirmedQuestionIndices = new Set(questions.map((q) => q.segment.index));
  const responseEvents = extractResponseEvents(transcript, confirmedQuestionIndices);
  const { findings: q678Findings, probingResults } = await checkResponseHandling(responseEvents);

  const questioningFindings: QuestioningFinding[] = [
    ...questionLevelFindings,
    ...q3Findings,
    ...q5Findings,
    ...q678Findings,
  ];

  await writeIntermediate("04-questions.json", questions);
  await writeIntermediate("04-questioning-findings.json", questioningFindings);
  await writeIntermediate("04-wait-time-by-question.json", waitTimeEvaluations);

  await writeStabilitySnapshot(sourceFile, {
    runAt: new Date().toISOString(),
    sourceFile,
    concept: conceptMatch,
    vocabFindings,
    questions,
    questioningFindings,
    waitTimeEvaluations,
  });

  console.log("\n=== 4단계 결과 ===");
  console.log("발문 유형 분류:");
  for (const q of questions) {
    console.log(`  [${q.segment.index}] (${q.questionType}) "${q.segment.text}"`);
  }

  console.log("\nQ5 대기 시간 — 발문별 전체 목록:");
  for (const e of waitTimeEvaluations) {
    const start = e.question.segment.start;
    if (e.waitTimeSec === null) {
      console.log(`  [${e.question.segment.index}] (${start}초) 대기시간 계산 안 함 — ${e.skippedReason}`);
    } else {
      console.log(
        `  [${e.question.segment.index}] (${start}초) 대기 ${e.waitTimeSec.toFixed(1)}초, 유형 "${e.question.questionType}" → ${e.severity ?? "해당 없음"}`
      );
    }
  }

  console.log(`\n지적사항 총 ${questioningFindings.length}건`);
  for (const id of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"]) {
    printQuestioningGroup(questioningFindings, id);
  }

  console.log("\n[5단계] 개선안 생성");
  const { suggestions, stats } = await generateImprovements(
    transcript,
    questions,
    questioningFindings,
    vocabFindings,
    conceptMatch,
    waitTimeEvaluations
  );
  await writeIntermediate("05-suggestions.json", suggestions);
  await writeIntermediate("05-suggestion-stats.json", stats);

  console.log(`\n=== 5단계 결과 === (지적 있는 발문 ${suggestions.length}개 중 개선안 생성)`);
  for (const s of suggestions) {
    console.log(`\n[${s.questionIndex}] "${s.originalQuestionText}"`);
    console.log(`  대상 기준: ${s.criteriaAddressed.join(", ")}`);
    if (s.revisedQuestionLine) console.log(`  개선 발문: ${s.revisedQuestionLine}`);
    if (s.hintQuestionLine) console.log(`  힌트 발문(반응 없을 때): ${s.hintQuestionLine}`);
    if (s.suggestedAction) console.log(`  개선 행동: ${s.suggestedAction}`);
    if (s.revisedResponseLine) console.log(`  교사 반응 대사: ${s.revisedResponseLine}`);
    for (const w of s.whatAndWhy) console.log(`  - ${w.criterionId}: "${w.quotedOriginalText}" → ${w.what} (${w.why})`);
    if (s.targetReactionSegmentIndices.length > 0) {
      console.log(`  고칠 반응 발화: [${s.targetReactionSegmentIndices.join(", ")}]`);
    }
    const v = s.validation;
    const validationFlags: string[] = [];
    if (v.regenerated) validationFlags.push("재생성됨");
    if (v.usedCodeReplacementResponseLine) validationFlags.push("코드 대체 대사 사용");
    if (v.stillFailingAfterRetry) validationFlags.push("⚠️ 재생성 후에도 검증 실패");
    if (validationFlags.length > 0) {
      const suffix = v.notes.length > 0 ? ` — ${v.notes.join("; ")}` : "";
      console.log(`  검증: ${validationFlags.join(", ")}${suffix}`);
    }
  }

  console.log("\n=== 5단계 검증 통계 ===");
  console.log("코드가 범위를 벗어난 필드를 정정한 건수:");
  const scopeEntries = Object.entries(stats.scopeCorrections);
  if (scopeEntries.length === 0) console.log("  없음");
  for (const [reason, count] of scopeEntries) console.log(`  - ${reason}: ${count}건`);

  console.log("\n1차 생성이 실패해서 재생성된 건수 (검증 항목별):");
  const failureEntries = Object.entries(stats.regenerationFailures);
  if (failureEntries.length === 0) console.log("  없음 (전부 1차에 통과)");
  for (const [key, count] of failureEntries) {
    console.log(`  - ${VALIDATION_CATEGORY_LABELS[key] ?? key}: ${count}건`);
  }

  await writeStabilitySnapshot(sourceFile, { stage: "05-suggestions", runAt: new Date().toISOString(), sourceFile, suggestions, stats });

  console.log("\n[6단계] 수업 전체 평가 리포트");
  const ignoredArg = process.argv[3];
  const ignoredFindingIds = new Set(
    ignoredArg ? ignoredArg.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : []
  );
  if (ignoredFindingIds.size > 0) {
    console.log(`  → 무시할 지적 index: [${[...ignoredFindingIds].join(", ")}] (questioningFindings 배열 기준)`);
  }

  const report = await generateLessonReport(
    {
      transcript,
      questions,
      questioningFindings,
      vocabFindings,
      waitTimeEvaluations,
      responseEvents,
      probingResults,
    },
    ignoredFindingIds
  );
  await writeIntermediate("06-report.json", report);

  console.log("\n=== 6단계 결과 ===");
  console.log("(기준 파일: criteria/lesson-criteria.json — 상태: 초안. '임시 기준'으로 표시된 항목은 수치가 아직 확정되지 않았습니다)");
  for (const m of report.metrics) {
    const tempTag = m.isTemporaryCriteria ? " [임시 기준]" : "";
    const gradeTag = m.grade ?? "(등급 없음)";
    console.log(`  [${m.id}] ${m.name}${tempTag}: ${gradeTag} — ${m.detail}`);
  }

  console.log("\n잘한 점:");
  for (const g of report.goodPoints) console.log(`  - ${g.text}`);

  console.log("\n먼저 고칠 점 (심각도 → 빈도 순):");
  for (const p of report.priorityFixes) {
    console.log(`  - [${p.criterionId} ${p.criterionName}] (${p.severity}) ${p.count}건 — 예: [${p.exampleSegmentIndices.join(", ")}]`);
  }

  console.log("\n총평:");
  console.log(`  ${report.overallSummary}`);
  for (const w of report.summaryWarnings) console.log(`  ${w}`);

  console.log(`\n중간 결과 저장 위치: ${intermediateDir()}`);
  console.log(`반복 실행 기록 저장 위치: ${path.join(stabilityDir(), path.basename(sourceFile, path.extname(sourceFile)))}`);
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
