import { notFound } from "next/navigation";
import { readAnalysis } from "../../lib/analysisStore.server.js";
import { loadQuestioningCriteria } from "../../../src/criteria/loadQuestioningCriteria.js";
import { LessonView } from "./LessonView.js";

export default async function LessonPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const analysis = await readAnalysis(name);
  if (!analysis) notFound();

  const severityOrder = Object.keys(loadQuestioningCriteria().definitions.severity);

  return <LessonView name={name} analysis={analysis} severityOrder={severityOrder} />;
}
