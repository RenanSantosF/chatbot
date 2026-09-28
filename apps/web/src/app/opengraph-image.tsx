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
  `${SITE_NAME} — seu WhatsApp atendendo sozinho, 24 horas`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** O traçado da logo (o mesmo de `<Marca>`), em cor chapada — o Satori desenha path simples. */
const LOGO = "M174.4 692.8 L164.6 693.2 L158.3 687.8 L157.1 682.9 L158.0 669.5 L156.3 659.8 L151.4 648.8 L144.1 639.0 L136.6 632.5 L106.1 612.7 L84.1 595.3 L64.3 575.6 L46.2 553.7 L32.5 531.7 L20.6 506.1 L13.2 484.1 L8.1 462.2 L4.6 429.3 L4.7 328.0 L7.0 301.2 L12.0 274.4 L25.3 231.7 L37.3 206.1 L48.3 186.6 L61.9 167.1 L85.4 139.4 L98.8 126.1 L122.0 107.0 L147.6 89.7 L172.0 76.8 L191.5 68.2 L224.4 57.2 L254.9 50.7 L284.1 47.2 L584.1 46.3 L625.6 48.6 L658.5 56.0 L686.6 67.1 L707.3 79.0 L731.7 98.2 L751.6 120.7 L769.9 151.2 L777.4 170.7 L781.9 189.0 L785.2 223.2 L782.1 254.9 L776.0 278.0 L768.8 296.3 L750.1 328.0 L731.7 349.4 L708.5 369.7 L692.7 380.6 L668.3 394.2 L640.2 406.4 L604.9 417.2 L498.8 443.3 L426.8 463.1 L372.0 483.8 L342.7 498.3 L324.4 509.3 L285.4 538.7 L264.6 560.1 L249.8 579.3 L237.4 600.0 L227.6 620.7 L217.1 648.8 L206.3 667.1 L191.5 683.1 L174.4 692.8Z M834.1 954.1 L823.2 954.1 L809.8 948.1 L719.5 888.7 L700.0 879.0 L682.9 873.9 L658.5 871.7 L443.9 871.5 L418.3 867.4 L388.0 857.3 L365.9 845.7 L350.4 834.1 L333.7 818.3 L319.4 800.0 L307.3 778.0 L299.7 757.3 L294.8 734.1 L293.3 707.3 L295.0 689.0 L299.9 665.9 L312.0 636.6 L324.0 617.1 L338.8 598.8 L363.4 576.4 L392.7 557.1 L439.0 536.4 L497.6 520.5 L609.8 496.9 L653.7 485.8 L692.7 472.3 L726.8 455.3 L756.1 434.6 L784.1 406.1 L797.8 386.6 L808.0 368.3 L817.7 345.1 L826.5 313.4 L832.9 307.2 L842.7 305.3 L850.0 306.9 L864.6 314.3 L887.8 329.9 L907.3 346.2 L923.2 362.3 L938.1 380.5 L961.2 417.1 L978.3 459.8 L987.0 501.2 L988.6 525.6 L988.6 608.5 L985.8 642.7 L978.5 673.2 L964.9 708.5 L944.2 743.9 L925.7 767.1 L904.9 788.1 L874.4 811.6 L835.4 835.1 L828.8 842.7 L823.1 853.7 L819.3 868.3 L819.2 890.2 L821.6 903.7 L827.9 922.0 L840.0 943.9 L838.3 951.2 L834.1 954.1Z";

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
          background: "linear-gradient(180deg, #eef7f4 0%, #ffffff 100%)",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        {/* O claro da landing, e não um fundo escuro: o card é a vitrine
            da mesma página, e precisa parecer com ela. */}
        <div
          style={{
            position: "absolute",
            top: -200,
            right: -160,
            width: 620,
            height: 620,
            borderRadius: 9999,
            background: "#04A680",
            opacity: 0.16,
            filter: "blur(90px)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="-20 -20 1040 1040">
            <path d={LOGO} fill="#04A680" />
          </svg>
          <div style={{ color: "#0f1a17", fontSize: 38, fontWeight: 700 }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              color: "#0f1a17",
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 980,
            }}
          >
            Seu WhatsApp atendendo&nbsp;
            <span style={{ color: "#008069" }}>sozinho, 24 horas.</span>
          </div>
          <div style={{ display: "flex", color: "#4b5b56", fontSize: 32, lineHeight: 1.4 }}>
            A IA responde na hora e chama sua equipe quando precisa de gente.
          </div>
        </div>

        <div style={{ display: "flex", gap: 28, color: "#008069", fontSize: 26, fontWeight: 600 }}>
          {/* O "✓" não existe na fonte embutida do Satori (sai um quadrado):
              o visto é desenhado. */}
          {["Sem trocar de número", "IA já inclusa", "Sem fidelidade"].map((item) => (
            <span key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="28" height="28" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="12" fill="#008069" />
                <path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.6" fill="none" />
              </svg>
              {item}
            </span>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
