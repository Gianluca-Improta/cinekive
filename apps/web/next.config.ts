import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  images: {
    unoptimized: true,
  },
  // Hide the Next.js "N" / build activity badge in the corner
  devIndicators: false,
};

export default nextConfig;
