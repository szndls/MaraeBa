import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "발문 코치",
  description: "수업 녹음으로 교사의 발문을 돌아보는 도구",
};

// 모든 화면 위에 공통으로 붙는 머리글(로고)과 글꼴 불러오기
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2.5 px-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-chalk text-sm font-bold text-white">발</span>
              <span className="text-[15px] font-bold tracking-tight">발문 코치</span>
            </Link>
            <span className="ml-1 hidden text-xs text-stone-400 sm:inline">수업 녹음으로 내 발문 돌아보기</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
