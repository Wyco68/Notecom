// Content-Security-Policy is NOT set here — it needs a per-request nonce
// (Next.js's App Router injects its own inline hydration scripts on every
// page, which a static script-src with no nonce/hash would silently block)
// and so lives in middleware.ts instead, built fresh per request. Everything
// below this comment has no reason to vary per request and is cheaper to
// serve as a static header Next can attach at the routing layer.
const SECURITY_HEADERS = [
  // Belt-and-suspenders alongside middleware's CSP frame-ancestors, for
  // browsers that predate CSP2 — this app is never meant to be embedded.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Every browser feature this app doesn't use, switched off so an XSS that
  // slips past CSP still can't reach the camera, mic or location.
  // (No `interest-cohort` — FLoC shipped and was killed before this app
  // existed; current browsers don't recognize it as a feature at all and log
  // a console warning for including it, not an opt-out of anything real.)
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HTTPS is already enforced by the hosting platform; this additionally
  // tells the browser to never even try plain HTTP for this origin again,
  // for the lifetime below. No `preload`: that submits the domain to
  // browsers' built-in preload list, which is effectively permanent and out
  // of scope for a config change to opt into on the app's behalf.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // @google-cloud/storage (GCS deployment only) uses dynamic requires the
  // bundler can't trace — keep it external so it's require()d at runtime.
  serverExternalPackages: ["@google-cloud/storage"],
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
  // The desktop shell's webview navigates to 127.0.0.1 while Next's dev
  // assets are requested relative to that origin — same host, just not
  // "localhost", which Next's dev-origin check treats as cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
