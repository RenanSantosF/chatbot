import type { NextConfig } from "next";

// Normaliza pra sempre ter protocolo: é comum colar só o domínio (ex:
// "sua-api.up.railway.app") na env var de produção, sem o "https://" na
// frente — e o Next recusa o build inteiro se o destino do rewrite não
// começar com http(s):// ou "/", com um erro que não deixa óbvio qual env
// var é a culpada.
function withProtocol(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

const API_INTERNAL_URL = withProtocol(process.env.API_INTERNAL_URL ?? "http://localhost:3001");

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
