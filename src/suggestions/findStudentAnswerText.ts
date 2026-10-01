import type { QuestionFindingsGroup } from "../types/suggestion.js";

/** Q8·Q6·Q7 순으로 학생 답변 발화를 찾는다(어느 기준이든 같은 응답 사건의 학생
 *  발화를 가리키므로 우선순위는 크게 중요하지 않다 — 존재하는 것을 쓴다). */
export function findStudentAnswerText(group: QuestionFindingsGroup): string | null {
  for (const id of ["Q8", "Q6", "Q7"]) {
    const finding = group.findings.find((f) => f.criterionId === id);
    const studentSeg = finding?.segments.find((s) => s.speaker === "student");
    if (studentSeg) return studentSeg.text;
  }
  return null;
}
