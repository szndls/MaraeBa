import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // src/* 전체가 "type": "module" 관례대로 상대경로 import에 .js 확장자를 붙인다
    // (실제 파일은 .ts). webpack 번들러가 .js를 .ts/.tsx로도 찾아보게 해서, 분석
    // 엔진 코드를 고치지 않고 그대로 import할 수 있게 한다.
    extensionAlias: {
      ".js": [".js", ".ts", ".tsx"],
    },
  },
  // criteria/*.json·*.yaml은 node:fs(readFileSync)로 런타임에 읽어서, 코드를 정적으로
  // 분석하는 Next의 파일 트레이싱이 못 찾는다 — Vercel 배포 번들에 빠지면 /api/analyze가
  // 깨지므로 명시적으로 포함시킨다.
  outputFileTracingIncludes: {
    "/api/*": ["./criteria/**/*"],
  },
};

export default nextConfig;
