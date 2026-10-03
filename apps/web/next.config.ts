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
  async rewrites() {
    const api = process.env.CINEKIVE_API_INTERNAL || "http://127.0.0.1:8000";
    return [{ source: "/cinekive-api/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
