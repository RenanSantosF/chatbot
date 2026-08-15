import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

/**
 * O card que aparece quando alguém cola o link no WhatsApp, no LinkedIn ou
 * no grupo da empresa.
 *
 * Desenhado em código, e não guardado como PNG, por dois motivos práticos:
 * a frase muda junto com a landing sem ninguém precisar reabrir um editor
 * de imagem, e não existe um arquivo binário no repositório que alguém
 * esqueça de atualizar. 1200×630 é a medida que o Facebook, o WhatsApp, o
 * LinkedIn e o X usam.
 */
export const alt =
  `${SITE_NAME} — atendimento no WhatsApp com inteligência artificial`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0f1211",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        {/* Verde do WhatsApp num canto, desfocado: dá identidade sem
            depender de uma imagem pra carregar. */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -140,
            width: 620,
            height: 620,
            borderRadius: 9999,
            background: "#1fab63",
            opacity: 0.22,
            filter: "blur(90px)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* O símbolo desenhado à mão, e não o componente <Marca>: esta
              imagem é gerada pelo Satori, que entende um subconjunto de SVG
              e não aceita degradê por <defs>. Duas cores chapadas dão o
              mesmo resultado no tamanho em que ela é vista. */}
          <svg width="56" height="56" viewBox="0 0 1024 1024">
            <rect width="1024" height="1024" rx="232" fill="#0C8B5E" />
            <path d="M318 620 L318 812 L470 640 Z" fill="#fff" />
            <rect x="212" y="258" width="600" height="414" rx="112" fill="#fff" />
            <circle cx="340" cy="462" r="46" fill="#006F58" />
            <circle cx="502" cy="462" r="46" fill="#006F58" />
            <path
              d="M664 392 Q678 448 734 462 Q678 476 664 532 Q650 476 594 462 Q650 448 664 392 Z"
              fill="#006F58"
            />
          </svg>
          <div style={{ color: "#f2f5f4", fontSize: 34, fontWeight: 600 }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              color: "#f2f5f4",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: -1.5,
              maxWidth: 940,
            }}
          >
            Seu cliente pergunta às duas da manhã. Alguém responde.
          </div>
          <div
            style={{
              display: "flex",
              color: "#9fb0aa",
              fontSize: 30,
              lineHeight: 1.4,
              maxWidth: 880,
            }}
          >
            Atendimento no WhatsApp com IA: resolve sozinha o repetitivo e
            chama sua equipe quando o assunto pede gente.
          </div>
        </div>

        <div style={{ display: "flex", color: "#6f817b", fontSize: 24 }}>
          Filas por setor · Base de conhecimento · Histórico que não evapora
        </div>
      </div>
    ),
    size,
  );
}
