import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingExcludes: {
    "/**": [
      ".data/**",
      "**/.data/**",
      "artifacts/**",
      "**/artifacts/**",
      ".env*",
      "**/.env*",
      ".netlify*",
      "**/.netlify*",
    ],
  },
  transpilePackages: ["@luxalgo/vela", "@luxalgo/vela-pinets"],
  serverExternalPackages: ["yahoo-finance2", "fast-xml-parser"],
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
  },
};
export default config;
