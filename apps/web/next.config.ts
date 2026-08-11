import type { NextConfig } from "next";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    // O navegador só fala com o próprio Next.js (mesma origem). Isso faz o
    // cookie httpOnly de sessão, setado pela API, ficar no domínio do
    // frontend — necessário pra Server Components lerem a sessão via
    // cookies() e pra evitar CORS no cliente.
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
