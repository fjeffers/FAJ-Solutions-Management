import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["@supabase/ssr", "@supabase/supabase-js"],
  // WorkFlow (Fred's Flutter app, built into public/workflow by
  // scripts/build-workflow.mjs) is one page that routes itself with #/… —
  // so the folder address serves its index.html.
  // Switchover (Fred, 2026-10-02): techs now work in WorkFlow. The old tech
  // portal stays reachable as a fallback at /tech?classic=1.
  async redirects() {
    return [
      { source: "/tech", missing: [{ type: "query", key: "classic" }], destination: "/workflow", permanent: false },
      { source: "/tech/login", missing: [{ type: "query", key: "classic" }], destination: "/workflow", permanent: false },
    ];
  },
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
      {
        // WorkFlow's offline worker lives in /workflow/ but must also cover the
        // page at /workflow itself (no trailing slash), and must never be cached
        // stale, or phones would keep an old copy of the app.
        source: "/workflow/wf-sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/workflow" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ];
  },
};
export default nextConfig;
