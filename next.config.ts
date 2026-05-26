/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/debug", destination: "/debug/index.html" },
      { source: "/debug/", destination: "/debug/index.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Powered-By", value: "" },
        ],
      },
    ];
  },
};

export default nextConfig;
