import Link from "next/link";

// 첫 화면: 제목 + 시작하기 + 기록
export default function Home() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col items-center justify-center px-4 pb-20 text-center">
      <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
        녹음 한 번으로,
        <br />
        <span className="bg-[linear-gradient(transparent_58%,#fde68a_58%)] px-1">내 수업 발문</span>을 돌아봐요
      </h1>
      <div className="mt-10 flex w-full max-w-xs flex-col gap-3">
        <Link href="/record" className="rounded-2xl bg-chalk py-4 text-lg font-bold text-white shadow-sm transition hover:brightness-110">
          시작하기
        </Link>
        <Link href="/history" className="rounded-2xl border border-line bg-white py-3.5 font-semibold text-stone-600 transition hover:bg-stone-50">
          기록
        </Link>
      </div>
    </main>
  );
}
