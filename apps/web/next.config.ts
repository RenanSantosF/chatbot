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
  /*
   * Foto de perfil em miniatura, e não a original.
   *
   * O WhatsApp entrega a foto em ~640px; a lista de conversas a mostra em
   * 44. Eram trinta fotos grandes a cada abertura do Inbox. Passando pelo
   * otimizador, cada avatar chega no tamanho em que é desenhado (em WebP),
   * e fica em cache no servidor — a URL do WhatsApp muda quando a foto é
   * renovada, então a entrada velha simplesmente deixa de ser pedida.
   * A foto inteira só é baixada no visualizador (ver AvatarDoCliente).
   */
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.whatsapp.net" }],
    qualities: [60, 75],
    minimumCacheTTL: 7 * 24 * 60 * 60,
  },
  /*
   * O Inbox morava em /dashboard/inbox e virou a raiz do painel. Link
   * antigo (notificação já entregue, favorito, app instalado) continua
   * chegando na conversa certa: o `?c=` é repassado pelo redirecionamento.
   */
  async redirects() {
    return [{ source: "/dashboard/inbox", destination: "/dashboard", permanent: false }];
  },
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
