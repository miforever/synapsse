import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",

  // Next's dev-only status badge sits in the bottom-left corner, which is
  // where the memory count already is — it covers it, and reads as part of the
  // app rather than as tooling. It never ships in a production build, so
  // turning it off costs nothing and makes what you see in development the
  // thing you are actually building.
  devIndicators: false,
};

export default nextConfig;
