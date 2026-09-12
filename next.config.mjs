/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "playwright", "tesseract.js", "unpdf"],
    instrumentationHook: true,
  },
};
export default nextConfig;
