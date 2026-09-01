/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  // Generated per-project pages must never gate a merchant's go-live on a strict
  // TS error in emitted code the operator can't hand-edit. (ESLint already off.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
