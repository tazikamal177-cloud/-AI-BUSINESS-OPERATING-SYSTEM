/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Reduces the production image by only including needed files.
  // Required by the multi-stage Dockerfile (frontend).
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
