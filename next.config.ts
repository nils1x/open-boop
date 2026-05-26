/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: "/debug", destination: "/debug/index.html" },
      { source: "/debug/", destination: "/debug/index.html" },
    ];
  },
};

export default nextConfig;
