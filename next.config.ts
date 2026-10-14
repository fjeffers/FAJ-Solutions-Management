import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["@supabase/ssr", "@supabase/supabase-js"],
  // One app (Fred, 2026-10-02: "all one app with a tech portal"). WorkFlow's
  // features and look now live in the FAJ app itself — Work Orders for Fred,
  // /tech for techs. The old separate WorkFlow address sends people to the tech
  // portal; a tech on it is in the right place, and anyone else is shown the way
  // to the office app from there.
  async redirects() {
    return [
      { source: "/workflow", destination: "/tech", permanent: false },
      { source: "/workflow/", destination: "/tech", permanent: false },
      { source: "/workflow/index.html", destination: "/tech", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Nothing may be shown inside another site's page ...
        source: "/((?!sheet/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // ... except the live project sheet, inside our own Office > Projects
        // (Fred, 2026-10-14: the office sees exactly what the client sees).
        source: "/sheet/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        // Phones that opened the separate WorkFlow app still have its offline
        // worker. It is now a retirement worker (public/workflow/wf-sw.js) that
        // clears itself away; the header lets the browser fetch that update for
        // the old /workflow scope, and no-cache makes sure it is picked up.
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
