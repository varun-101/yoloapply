/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "playwright", "tesseract.js"],
    instrumentationHook: true,
  },
};
export default nextConfig;
