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
};

export default nextConfig;
