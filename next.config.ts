import type { NextConfig } from "next";
import { CATALOG } from "./src/lib/lessons/catalog";

const config: NextConfig = {
  poweredByHeader: false,
  // The badge sits on top of the playback dock; build and runtime errors still show.
  devIndicators: false,
  // A lesson that ever changes its slug keeps its old one as an alias, so old links and bookmarks still arrive.
  async redirects() {
    return CATALOG.flatMap((e) => (e.aliases ?? []).map((old) => ({ source: `/learn/${old}`, destination: `/learn/${e.slug}`, permanent: true })));
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
