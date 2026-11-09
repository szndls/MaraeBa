# 발문 코치

초등학교 교사·예비교사(교대생)를 위한 수업 발문(질문) 분석 도구입니다. 수업 녹음을
올리면 AI가 교사의 발화를 받아쓰고, 어떤 발문이 부족했는지 찾아 개선안을 제안하고,
수업 전체를 평가하는 리포트를 만들어 줍니다. 수학 교과(초등 수학 교육과정 성취기준
기준)로 범위를 한정했고, 학생은 기기를 쓰지 않으며 교사만 사용합니다.

## 설치·실행

```bash
npm install
cp .env.local.example .env.local   # 이 파일에 OPENAI_API_KEY를 넣으세요
npm run dev
```

`.env.local`을 열어서 `OPENAI_API_KEY=sk-...` 자리에 본인의 OpenAI API 키를 넣습니다.
이 파일은 `.gitignore`에 포함돼 있어 커밋·push되지 않습니다. 브라우저에서
`http://localhost:3000`으로 접속하면 됩니다.

## 사용 흐름

1. **홈** — "시작하기"로 새 수업을 녹음하거나, "기록"에서 저장한 지난 수업을 봅니다.
2. **/record** — 처음 한 번은 교사 목소리를 8초 녹음해 화자 구분에 씁니다(이후 생략).
   이어서 수업 녹음을 시작하고, 학년을 고른 뒤 "녹음 끝내고 분석하기"를 누르면 받아쓰기
   → 개념 찾기 → 발문 진단 → 보고서 순서로 자동 분석됩니다.
3. **보고서** — 발문별 지적·개선안과 수업 전체 평가를 보고, "저장하기"로 기록에
   남기거나 "홈으로" 돌아갑니다.
4. **/history** — 저장해 둔 수업 기록을 다시 열어볼 수 있습니다.

터미널에서 직접 돌려볼 수도 있습니다:

```bash
npm run transcribe -- <오디오파일> <교사목소리샘플> <학년(1~6)>   # 1단계: 받아쓰기
npm run analyze -- <전사본.json>                                   # 2~6단계: 분석
```

## 폴더 구조

```
app/        화면(Next.js App Router) — 홈, /record, /history, /lesson/[name], API 라우트
src/        분석 파이프라인 — input(전사본 정규화) / concept(개념 추측) / vocab(용어 탐지)
            / questioning(발문 탐지·판정) / suggestions(개선안) / report(전체 리포트)
            / criteria(기준 파일 로더) / llm(OpenAI 클라이언트)
criteria/   평가 기준 파일(JSON/YAML) — 코드를 고치지 않고 이 파일만 바꿔서 기준을 조정
output/     분석 결과·중간 산출물 (gitignore, 커밋 안 됨)
recordings/ 수업·목소리 녹음 파일 (gitignore, 커밋 안 됨)
```
