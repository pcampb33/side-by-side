import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Local development only (CLAUDE_AUTH=login). Bundling it fails: Turbopack
  // follows its Windows System32 paths outside the project.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
