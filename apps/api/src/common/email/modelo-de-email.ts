/**
 * O e-mail da Inteliwa, num formato só.
 *
 * Cliente de e-mail não é navegador: nada de CSS em arquivo, de flex ou de
 * fonte carregada. Estilo em linha e blocos simples é o que aparece igual
 * no Gmail, no Outlook e no app do celular.
 */

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Endereço do painel, de onde saem os links dos e-mails. */
export function enderecoDoPainel(caminho = '/dashboard'): string {
  const base =
    process.env.WEB_APP_URL?.trim().replace(/\/+$/, '') ||
    'http://localhost:3000';
  return `${base}${caminho}`;
}

export interface Destaque {
  rotulo: string;
  valor: string;
}

export interface ConteudoDoEmail {
  /** Primeira linha do cartão, em negrito ("Olá, Ana!"). */
  saudacao: string;
  paragrafos: string[];
  /** Números em grade (o relatório semanal). */
  destaques?: Destaque[];
  /** Itens em lista simples, abaixo dos parágrafos. */
  lista?: { titulo: string; itens: string[] };
  botao?: { texto: string; url: string };
  /** Letra miúda no fim (por que a pessoa recebeu, como parar). */
  rodape?: string;
  /** Cor do botão e da faixa: verde no normal, vermelho no alerta. */
  tom?: 'normal' | 'alerta';
}

const COR = { normal: '#04A680', alerta: '#D93636' };

/** O HTML e o texto puro do mesmo conteúdo — o Resend manda os dois. */
export function montarEmail(conteudo: ConteudoDoEmail): {
  html: string;
  texto: string;
} {
  const cor = COR[conteudo.tom ?? 'normal'];

  const destaques = conteudo.destaques?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 20px;border-collapse:separate;border-spacing:0 8px">${conteudo.destaques
        .map(
          (d) =>
            `<tr><td style="padding:10px 14px;background:#f3f6f4;border-radius:8px;font-size:14px;color:#4a524d">${escaparHtml(d.rotulo)}</td><td style="padding:10px 14px;background:#f3f6f4;border-radius:8px;font-size:16px;font-weight:600;text-align:right;color:#1a1f1c">${escaparHtml(d.valor)}</td></tr>`,
        )
        .join('')}</table>`
    : '';

  const lista = conteudo.lista?.itens.length
    ? `<p style="margin:0 0 8px;font-size:14px;font-weight:600">${escaparHtml(conteudo.lista.titulo)}</p><ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.5;color:#4a524d">${conteudo.lista.itens
        .map((item) => `<li style="margin:0 0 4px">${escaparHtml(item)}</li>`)
        .join('')}</ul>`
    : '';

  const botao = conteudo.botao
    ? `<a href="${escaparHtml(conteudo.botao.url)}" style="display:inline-block;background:${cor};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${escaparHtml(conteudo.botao.texto)}</a>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f6f7f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1f1c">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-size:18px;font-weight:600;margin:0 0 24px">Inteliwa</p>
    <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e4e7e5;border-top:4px solid ${cor}">
      <p style="margin:0 0 12px;font-size:16px;font-weight:600">${escaparHtml(conteudo.saudacao)}</p>
      ${conteudo.paragrafos
        .map(
          (p) =>
            `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#4a524d">${escaparHtml(p)}</p>`,
        )
        .join('')}
      ${destaques}${lista}${botao}
    </div>
    ${conteudo.rodape ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#8a918c">${escaparHtml(conteudo.rodape)}</p>` : ''}
  </div>
</body></html>`;

  const texto = [
    conteudo.saudacao,
    '',
    ...conteudo.paragrafos.flatMap((p) => [p, '']),
    ...(conteudo.destaques ?? []).map((d) => `${d.rotulo}: ${d.valor}`),
    ...(conteudo.destaques?.length ? [''] : []),
    ...(conteudo.lista?.itens.length
      ? [
          conteudo.lista.titulo,
          ...conteudo.lista.itens.map((i) => `- ${i}`),
          '',
        ]
      : []),
    ...(conteudo.botao
      ? [`${conteudo.botao.texto}: ${conteudo.botao.url}`, '']
      : []),
    ...(conteudo.rodape ? [conteudo.rodape] : []),
  ]
    .join('\n')
    .trim();

  return { html, texto };
}
