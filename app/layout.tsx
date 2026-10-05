import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "발문 코치",
  description: "수업 발문 분석 결과 보기",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
