/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "playwright", "tesseract.js"],
  },
};
export default nextConfig;
