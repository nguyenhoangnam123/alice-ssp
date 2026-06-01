/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",   // standalone build for the Docker image — minimal runtime artifact
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
