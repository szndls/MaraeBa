import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { transcribeAudio } from "./input/transcribeAudio.js";
import { loadFromDiarizeResult, validateGrade } from "./input/loadTranscript.js";

loadEnv({ path: ".env.local" });

function printUsageAndExit(): never {
  console.error(
    "사용법: npm run transcribe -- <오디오파일> <교사목소리샘플파일> <학년(1~6)> [출력이름]\n" +
      "  예: npm run transcribe -- recordings/test-lesson.mp3 recordings/teacher-sample.mp3 3"
  );
  process.exit(1);
}

async function main() {
  const [audioFileArg, teacherSampleArg, gradeArg, outputNameArg] = process.argv.slice(2);

  if (!audioFileArg || !teacherSampleArg || !gradeArg) {
    printUsageAndExit();
  }

  const grade = Number(gradeArg);
  validateGrade(grade);

  const audioFilePath = path.resolve(process.cwd(), audioFileArg);
  const teacherSampleFilePath = path.resolve(process.cwd(), teacherSampleArg);
  const outputName = outputNameArg || path.basename(audioFileArg, path.extname(audioFileArg));

  console.log(`[1단계] 음성 인식 + 화자 분리 중: ${audioFileArg} (교사 샘플: ${teacherSampleArg})`);
  const rawResponse = await transcribeAudio({ audioFilePath, teacherSampleFilePath });

  const transcript = loadFromDiarizeResult(rawResponse, grade);

  const teacherCount = transcript.segments.filter((s) => s.speaker === "teacher").length;
  const studentCount = transcript.segments.filter((s) => s.speaker === "student").length;
  console.log(`  → 세그먼트 ${transcript.segments.length}개 (교사 ${teacherCount}, 학생 ${studentCount})`);

  const outputDir = path.resolve(process.cwd(), "output", "transcripts");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${outputName}.json`);
  await writeFile(outputPath, JSON.stringify(transcript, null, 2), "utf-8");

  console.log(`\n저장 위치: ${outputPath}`);
  console.log(`이어서 분석하려면: npm run analyze -- ${path.relative(process.cwd(), outputPath)}`);
}

// `tsx src/transcribe.ts`로 직접 실행했을 때만 돈다 — 다른 모듈이 이 파일을 import해도
// main()이 저절로 실행되면 안 된다(src/run.ts와 같은 이유).
const isMainModule = process.argv[1] ? import.meta.url === `file://${path.resolve(process.argv[1])}` : false;

if (isMainModule) {
  main().catch((err) => {
    console.error("음성 인식 중 오류가 발생했습니다:", err);
    process.exit(1);
  });
}
