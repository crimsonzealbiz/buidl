import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "litesvm"],
  // Migrations are read from disk at runtime; ship them with serverless functions.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
};

export default nextConfig;
