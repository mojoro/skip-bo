import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'standalone',
  // Next.js warns (and in some minor versions blocks) cross-origin dev
  // requests when a LAN peer hits the dev server at `<host>:3000`. Accept
  // private-network hostnames so any peer on the subnet can load the app.
  // Adjust if the host's LAN IP changes. Ignored in production builds.
  allowedDevOrigins: ['192.168.0.29', 'localhost', '127.0.0.1'],
};

export default nextConfig;
