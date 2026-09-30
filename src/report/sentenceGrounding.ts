/**
 * 총평과 L5(발문 흐름)가 공유하는 "문장 단위 근거 검증" 로직. LLM에게 자유 문단이
 * 아니라 문장 배열 {text, criterionIds, citedSegmentIndices}을 받게 해서, 각 문장이
 * 실제로 어떤 기준(Q1~Q9, L1~L8)의 무슨 근거에 기대고 있는지 코드가 확인할 수 있게
 * 한다. "발문 중복"처럼 기준에 없는 개념이나, 다른 기준의 근거 발화를 잘못 끌어다
 * 쓰는 것(예: 학생 발화를 "발문"의 근거로 인용)을 여기서 잡는다.
 */
export interface RawSummarySentence {
  text: string;
  criterionIds: string[];
  citedSegmentIndices: number[];
}

export interface GroundingOptions {
  /** 이 문장 배열이 반드시 한 번은 언급해야 하는 기준 id (없으면 검사 생략) */
  mustMentionCriterionId?: string | null;
}

/**
 * evidenceByCriterion: 기준 id → 그 기준의 지적·잘한 점·지표 계산에 실제로 쓰인
 * 발화 index 집합. 문장이 criterionIds로 어떤 기준을 걸었다면, citedSegmentIndices의
 * 각 번호는 그 기준들 중 적어도 하나의 evidence 집합 안에 있어야 한다.
 */
export function validateSentenceGrounding(
  sentences: RawSummarySentence[],
  evidenceByCriterion: Map<string, Set<number>>,
  allowedCriteriaIds: Set<string>,
  options: GroundingOptions = {}
): string[] {
  const problems: string[] = [];
  let mentionsRequired = !options.mustMentionCriterionId;

  for (const s of sentences) {
    if (s.criterionIds.length === 0) {
      problems.push(`기준(criterionIds) 없이 쓴 문장: "${s.text}"`);
      continue;
    }
    const unknownIds = s.criterionIds.filter((id) => !allowedCriteriaIds.has(id));
    if (unknownIds.length > 0) {
      problems.push(`목록에 없는 기준(${unknownIds.join(", ")})을 사용한 문장: "${s.text}"`);
    }

    if (s.citedSegmentIndices.length === 0) {
      problems.push(`인용 발화 번호가 없는 문장: "${s.text}"`);
    } else {
      for (const idx of s.citedSegmentIndices) {
        const groundedForAny = s.criterionIds.some((id) => evidenceByCriterion.get(id)?.has(idx));
        if (!groundedForAny) {
          problems.push(
            `발화 [${idx}]가 ${s.criterionIds.join(",")}의 근거와 연결되지 않는 문장: "${s.text}"`
          );
        }
      }
    }

    if (options.mustMentionCriterionId && s.criterionIds.includes(options.mustMentionCriterionId)) {
      mentionsRequired = true;
    }
  }

  if (!mentionsRequired) {
    problems.push(`우선 개선 기준(${options.mustMentionCriterionId})이 문장에 한 번도 언급되지 않음`);
  }

  return problems;
}

export function joinSentences(sentences: RawSummarySentence[]): string {
  return sentences.map((s) => s.text.trim()).join(" ");
}
