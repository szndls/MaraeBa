# criteria 폴더

AI 분류/판단에 쓰이는 **기준**을 담는 폴더입니다. 코드를 고치지 않고도 이 파일들만 수정하면
분석 결과에 반영됩니다. (CLAUDE.md의 "기준 관리" 원칙 참고)

## 파일 목록

| 파일 | 단계 | 상태 |
|---|---|---|
| `math-terms.json` | 2·3단계 | 사용 중 — 초등 수학 교육과정 성취기준/용어 목록 (원문 대조 필요한 항목은 파일 내 `verified: false` 표시) |
| `concept-guess-guidelines.yaml` | 2단계 | 사용 중 — 개념 추측 기준 (임시, 자유 수정 가능) |
| `vocab-detection-notes.yaml` | 3단계 | 사용 중 — "목록에 없는 어려운 어휘" LLM 판단 기준 |
| `questioning-criteria.json` | 4단계 | 사용 중 — 발문 유형 분류(Blosser) + Q1~Q9 지적 기준 |
| `improvement-guidelines.json` | 5단계 | 사용 중 — 개선안 톤/길이/기준별 방향 |
| `lesson-criteria.json` | 6단계 | 미사용 — 초안 (5단계 구현 후 다듬을 예정) |

## math-terms.json 사용 방식

- 2단계: 교사가 입력한 학년으로 학년군(band)을 찾고, 그 학년군의 모든 성취기준 코드 중
  하나를 LLM이 고른다 (코드 목록에 없는 값은 고를 수 없도록 강제).
- 3단계(예정): 매칭된 성취기준을 기준으로, 교사 발화에 등장하는 용어가
  - 더 높은 학년군/중학교 용어면 **아직 모름 확정**
  - 같은 학년군·같은 영역에서 뒤 순번 성취기준 용어면 **아직 모를 수 있음**
  - 목록에 없는 어려운 말이면(LLM 판단) **목록에 없는 어려운 어휘**
  로 분류한다. `math-terms.json`의 `how_to_use` 필드에 규칙이 적혀 있다.

## questioning-criteria.json 사용 방식

- 발문 후보(물음표 또는 의문형 어미로 끝나는 교사 발화)를 코드로 추출한 뒤, LLM이
  `question_type_scheme`대로 유형을 분류하고 동시에 진짜 발문인지 확인한다 (발문이
  아니면 결과에서 제외).
- `criteria` 배열의 각 항목은 `detect` 값대로 판정한다: `code`는 코드만, `llm`은 AI만,
  `code+llm`은 코드가 후보를 찾고 AI가 확인.
- 임계값(예: Q5의 대기 시간 초 단위 숫자)은 문구에서 파싱해서 쓰지, 코드에 별도로 적어두지
  않는다. 숫자를 바꾸려면 이 파일의 문구만 고치면 된다.
- `excluded` 배열에 있는 항목(지명 편중, wait_time_2, 교과서 문장 그대로 묻기, 같은 발문
  반복)은 이번 버전에 구현하지 않았다.

## improvement-guidelines.json 사용 방식

- 4단계 지적이 있는 발문마다 개선안 하나를 만든다 (지적이 여러 개면 전부 하나로 묶음).
- Q1·Q2·Q4·Q9는 "개선 발문"(문장 재작성), Q3·Q5·Q6·Q7·Q8은 "개선 행동"(교사가 할 일 +
  예시 대사)으로 나뉜다. `per_criterion_guidance`에서 기준별 방향을 정의한다.
- Q5의 "몇 초 기다리기" 숫자는 LLM이 아니라 코드가 `questioning-criteria.json`의 Q5
  임계값과 실제 대기시간으로 계산한다 (`src/questioning/checkWaitTime.ts`의
  `computeWaitTimeAdvice`).
- 개선 발문은 Q1·Q2·Q4·Q9 전체로 재분류 검증하고, 개선 발문·예시 대사 둘 다 3단계
  "아직 모름 확정" 용어 포함 여부를 검사한다. 실패하면 1회만 재생성한다
  (`validation.max_retry`).

## 수정 가능한 것 / 불가능한 것

- **수정 가능**: 모든 YAML 파일의 설명/예시/톤. `math-terms.json`의 내용(용어, 성취기준
  요약, verified 여부 등) — 원문 대조 후 고쳐도 됩니다.
- **주의**: `math-terms.json`의 `code` 값은 코드에서 참조하므로, 코드 체계 자체를 바꾸면
  (예: 성취기준 코드 형식 변경) `src/criteria/loadMathTerms.ts`도 함께 확인해야 합니다.
