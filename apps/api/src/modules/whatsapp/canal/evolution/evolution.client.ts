/**
 * As chamadas cruas pro servidor Evolution.
 *
 * Separado de quem usa pelo mesmo motivo de `meta-texto`: tem mais de um
 * chamador com natureza diferente (o envio, que roda dentro de uma
 * requisição, e a conexão por QR code, que é uma tela de configuração), e
 * duplicar a chamada é como um dos dois fica pra trás quando a API do
 * servidor muda de versão.
 *
 * Nada aqui lança por falha de rede: o resultado sempre diz se deu certo.
 * Envio que não chegou não pode derrubar o fluxo interno de conversa.
 */

/**
 * Até quando esperar o servidor responder.
 *
 * Mais curto que o da Meta (20s) porque a Evolution é um servidor nosso,
 * na mesma rede ou perto dela: se ela demorou dez segundos, ela não vai
 * responder — está reiniciando, ou a sessão caiu. Insistir só segura o
 * processamento do webhook, que a Meta e a própria Evolution reenviam
 * quando demoramos.
 */
const TEMPO_LIMITE_MS = 10_000;

/**
 * Os eventos que assinamos, num lugar só.
 *
 * Assinar tudo faria o servidor despejar presença, digitação e cada
 * atualização de foto de perfil no nosso webhook — tráfego que só custa e
 * nunca é lido.
 */
const EVENTOS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
];

export interface RespostaDaEvolution<T = unknown> {
  ok: boolean;
  /** O corpo já convertido, quando deu certo. */
  dados?: T;
  /** Motivo legível da falha, pronto pra log ou pro balão de quem atende. */
  erro?: string;
  status?: number;
}

export interface Credenciais {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

/**
 * O que o Node esconde atrás de "fetch failed".
 *
 * Mesmo problema do caminho da Meta, e mais provável aqui: o servidor
 * Evolution é infraestrutura própria, então cai, reinicia e muda de
 * endereço com uma frequência que a Meta não tem. "fetch failed" sozinho
 * no log não distingue endereço errado de servidor no chão.
 */
function detalhar(erro: unknown): string {
  const partes: string[] = [];
  let atual: unknown = erro;

  for (let nivel = 0; nivel < 4 && atual instanceof Error; nivel += 1) {
    const codigo = (atual as { code?: string }).code;
    partes.push(codigo ? `${atual.message} (${codigo})` : atual.message);
    atual = (atual as { cause?: unknown }).cause;
  }

  return partes.length > 0 ? partes.join(' <- ') : String(erro);
}

/**
 * O motivo da recusa, do jeito que a Evolution escreve.
 *
 * Ela não tem um formato único: às vezes é `{ message }`, às vezes
 * `{ error }`, às vezes `{ response: { message: [...] } }` quando a
 * validação do corpo reprova. Tentar os três é o que separa "o número não
 * existe no WhatsApp" de um JSON inteiro despejado na tela de quem
 * atende.
 */
export function motivoDaEvolution(corpo: string, status: number): string {
  try {
    const json = JSON.parse(corpo) as {
      message?: unknown;
      error?: unknown;
      response?: { message?: unknown };
    };

    const bruto = json.response?.message ?? json.message ?? json.error;
    const texto = Array.isArray(bruto) ? bruto.join('; ') : bruto;
    if (typeof texto === 'string' && texto.trim()) return texto.trim();
  } catch {
    // Corpo que não é JSON cai no genérico abaixo.
  }

  if (status === 401 || status === 403) {
    return 'a chave da API do servidor de mensagens foi recusada';
  }
  if (status === 404) {
    return 'a sessão não existe mais no servidor de mensagens';
  }
  return `o servidor de mensagens recusou (HTTP ${status})`;
}

async function chamar<T>(
  credenciais: Pick<Credenciais, 'baseUrl' | 'apiKey'>,
  caminho: string,
  init: { method: string; body?: unknown },
): Promise<RespostaDaEvolution<T>> {
  // A barra do fim do endereço é o erro de digitação mais comum ao colar
  // uma URL, e sem isto vira "//message/..." — que alguns servidores
  // aceitam e outros devolvem 404 sem explicação.
  const base = credenciais.baseUrl.replace(/\/+$/, '');

  try {
    const resposta = await fetch(`${base}${caminho}`, {
      method: init.method,
      headers: {
        apikey: credenciais.apiKey,
        'Content-Type': 'application/json',
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });

    const corpo = await resposta.text();
    if (!resposta.ok) {
      return {
        ok: false,
        erro: motivoDaEvolution(corpo, resposta.status),
        status: resposta.status,
      };
    }

    try {
      return { ok: true, dados: JSON.parse(corpo) as T, status: resposta.status };
    } catch {
      // Resposta vazia é sucesso em várias rotas (desconectar, apagar).
      return { ok: true, status: resposta.status };
    }
  } catch (erro) {
    return {
      ok: false,
      erro: `não deu pra falar com o servidor de mensagens (${detalhar(erro)})`,
    };
  }
}

/** O id que a Evolution devolve depois de aceitar a mensagem. */
export interface EnvioAceito {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
}

export function enviarTexto(
  credenciais: Credenciais,
  envio: { numero: string; texto: string; citando?: string | null },
): Promise<RespostaDaEvolution<EnvioAceito>> {
  return chamar(credenciais, `/message/sendText/${credenciais.instance}`, {
    method: 'POST',
    body: {
      number: envio.numero,
      text: envio.texto,
      ...(envio.citando
        ? { quoted: { key: { id: envio.citando } } }
        : {}),
    },
  });
}

export function enviarReacao(
  credenciais: Credenciais,
  reacao: { remoteJid: string; fromMe: boolean; id: string; emoji: string },
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/message/sendReaction/${credenciais.instance}`, {
    method: 'POST',
    body: {
      key: {
        remoteJid: reacao.remoteJid,
        fromMe: reacao.fromMe,
        id: reacao.id,
      },
      reaction: reacao.emoji,
    },
  });
}

export function marcarComoLida(
  credenciais: Credenciais,
  chave: { remoteJid: string; fromMe: boolean; id: string },
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/chat/markMessageAsRead/${credenciais.instance}`, {
    method: 'POST',
    body: { readMessages: [chave] },
  });
}

export interface InstanciaCriada {
  qrcode?: { base64?: string; code?: string };
  instance?: { instanceName?: string; status?: string };
}

export function criarInstancia(
  credenciais: Credenciais,
  webhookUrl: string,
): Promise<RespostaDaEvolution<InstanciaCriada>> {
  return chamar(credenciais, '/instance/create', {
    method: 'POST',
    body: {
      instanceName: credenciais.instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        enabled: true,
        events: EVENTOS,
      },
    },
  });
}

/**
 * Registra (ou corrige) o endereço que o servidor deve chamar.
 *
 * Separado da criação da sessão porque criar só acontece UMA vez, e o
 * endereço precisa valer sempre. Sem uma chamada própria, reconectar
 * numa sessão que já existe deixava o webhook com o endereço de antes —
 * ou sem endereço nenhum — e o sintoma era o pior possível: tudo
 * conectado, mensagem chegando no servidor, e silêncio no painel.
 *
 * Também é o que faz uma troca de domínio da API se resolver sozinha na
 * próxima conexão.
 */
export function definirWebhook(
  credenciais: Credenciais,
  webhookUrl: string,
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/webhook/set/${credenciais.instance}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: EVENTOS,
      },
    },
  });
}

export interface WebhookRegistrado {
  enabled?: boolean;
  url?: string;
  events?: string[];
}

/** O que está registrado hoje. Serve pra tela dizer a verdade. */
export function consultarWebhook(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution<WebhookRegistrado>> {
  return chamar(credenciais, `/webhook/find/${credenciais.instance}`, {
    method: 'GET',
  });
}

export function conectar(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution<InstanciaCriada>> {
  return chamar(credenciais, `/instance/connect/${credenciais.instance}`, {
    method: 'GET',
  });
}

export interface EstadoDaConexao {
  instance?: { state?: string };
}

export function estado(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution<EstadoDaConexao>> {
  return chamar(credenciais, `/instance/connectionState/${credenciais.instance}`, {
    method: 'GET',
  });
}

export function desconectar(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/instance/logout/${credenciais.instance}`, {
    method: 'DELETE',
  });
}

export function apagarInstancia(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/instance/delete/${credenciais.instance}`, {
    method: 'DELETE',
  });
}
