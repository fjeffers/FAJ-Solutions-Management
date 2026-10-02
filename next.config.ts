import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["@supabase/ssr", "@supabase/supabase-js"],
  // WorkFlow (Fred's Flutter app, built into public/workflow by
  // scripts/build-workflow.mjs) is one page that routes itself with #/… —
  // so the folder address serves its index.html.
  async rewrites() {
    return [
      { source: "/workflow", destination: "/workflow/index.html" },
      { source: "/workflow/", destination: "/workflow/index.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};
export default nextConfig;
