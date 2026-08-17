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
 * O mesmo, para as chamadas que carregam arquivo.
 *
 * Mídia não cabe no orçamento das outras: o binário vai em base64 no
 * corpo (~33% maior que o arquivo), e depois a Evolution ainda cifra e
 * sobe pro WhatsApp antes de responder. Dez segundos derrubava o envio de
 * um vídeo que teria dado certo — e o cliente via "não deu pra enviar" por
 * uma mensagem que estava a caminho.
 */
const TEMPO_LIMITE_MIDIA_MS = 60_000;

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
  // Por onde chegam as conversas que JÁ existiam no aparelho. Sem assinar
  // este, o pareamento trazia o telefone e mais nada: conversa antiga não
  // aparecia, e a que aconteceu pelo celular enquanto o painel estava
  // desconectado sumia pra sempre.
  // NÃO acrescente 'MESSAGING_HISTORY_SET' aqui: o servidor valida esta
  // lista contra um enum e recusa a CHAMADA INTEIRA ao encontrar um nome
  // que não conhece. O endereço de retorno deixa de ser registrado e a
  // conexão falha — por um item que só queria trazer conversa antiga.
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
  init: { method: string; body?: unknown; tempoLimiteMs?: number },
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
      signal: AbortSignal.timeout(init.tempoLimiteMs ?? TEMPO_LIMITE_MS),
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

/**
 * Envia um arquivo.
 *
 * O binário vai em base64 no corpo, e não como upload separado: a
 * Evolution não tem a etapa de "subir e receber um id" da Cloud API. Isso
 * infla o corpo em ~33%, e é o motivo de o tempo limite deste envio ser
 * maior que o das outras chamadas — um vídeo de alguns megabytes leva mais
 * que dez segundos pra atravessar.
 *
 * `mediatype` é o vocabulário dela (image/video/audio/document), e é o que
 * decide como o anexo aparece no aparelho do cliente.
 */
export function enviarMidia(
  credenciais: Credenciais,
  envio: {
    numero: string;
    tipo: 'image' | 'video' | 'audio' | 'document';
    base64: string;
    mimetype: string;
    filename: string;
    legenda?: string;
    citando?: string | null;
  },
): Promise<RespostaDaEvolution<EnvioAceito>> {
  return chamar(
    credenciais,
    `/message/sendMedia/${credenciais.instance}`,
    {
      method: 'POST',
      tempoLimiteMs: TEMPO_LIMITE_MIDIA_MS,
      body: {
        number: envio.numero,
        mediatype: envio.tipo,
        mimetype: envio.mimetype,
        media: envio.base64,
        fileName: envio.filename,
        ...(envio.legenda ? { caption: envio.legenda } : {}),
        ...(envio.citando ? { quoted: { key: { id: envio.citando } } } : {}),
      },
    },
  );
}

/**
 * Envia áudio como MENSAGEM DE VOZ.
 *
 * Rota separada de propósito, e a diferença é visível pro cliente: por
 * aqui o áudio chega como a bolha de voz com forma de onda; por
 * `sendMedia` chegaria como um arquivo anexado com nome. Quem gravou
 * apertando o microfone espera o primeiro.
 */
export function enviarAudioDeVoz(
  credenciais: Credenciais,
  envio: { numero: string; base64: string; citando?: string | null },
): Promise<RespostaDaEvolution<EnvioAceito>> {
  return chamar(
    credenciais,
    `/message/sendWhatsAppAudio/${credenciais.instance}`,
    {
      method: 'POST',
      tempoLimiteMs: TEMPO_LIMITE_MIDIA_MS,
      body: {
        number: envio.numero,
        audio: envio.base64,
        ...(envio.citando ? { quoted: { key: { id: envio.citando } } } : {}),
      },
    },
  );
}

export interface MidiaEmBase64 {
  base64?: string;
  mimetype?: string;
  /** Algumas versões devolvem os dados aninhados aqui. */
  message?: { mimetype?: string };
}

/**
 * Busca o binário de uma mídia já recebida ou enviada.
 *
 * Aqui está a diferença de modelo que mais importa entre os dois
 * provedores. A Meta hospeda o arquivo por 30 dias e dá um id pra buscá-lo
 * quando quiser. A Evolution não hospeda nada: ela pede o arquivo ao
 * WhatsApp usando a CHAVE DA MENSAGEM, do mesmo jeito que o aplicativo do
 * celular faz ao abrir uma conversa antiga.
 *
 * A consequência prática é que o handle da Evolution é a chave da
 * mensagem, e não um id de arquivo — e é por isso que o contrato do canal
 * fala em `handle` opaco em vez de `mediaId`.
 */
export function baixarMidia(
  credenciais: Credenciais,
  chave: { remoteJid: string; fromMe: boolean; id: string },
): Promise<RespostaDaEvolution<MidiaEmBase64>> {
  return chamar(
    credenciais,
    `/chat/getBase64FromMediaMessage/${credenciais.instance}`,
    {
      method: 'POST',
      tempoLimiteMs: TEMPO_LIMITE_MIDIA_MS,
      body: { message: { key: chave }, convertToMp4: false },
    },
  );
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
  qrcode?: {
    base64?: string;
    code?: string;
    /**
     * O código de oito caracteres do pareamento por número.
     *
     * Aceito em três lugares de propósito: a Evolution mudou onde ele
     * mora entre versões (`qrcode.pairingCode`, `pairingCode` na raiz), e
     * caçar isso em produção custaria o mesmo que aceitar os três aqui.
     * É a mesma precaução que fez os tiques voltarem a funcionar.
     */
    pairingCode?: string;
  };
  pairingCode?: string;
  instance?: { instanceName?: string; status?: string };
}

/** O código de pareamento, venha ele de onde vier. */
export function codigoDePareamento(
  dados: InstanciaCriada | undefined,
): string | null {
  return dados?.qrcode?.pairingCode ?? dados?.pairingCode ?? null;
}

export function criarInstancia(
  credenciais: Credenciais,
  webhookUrl: string,
  numero?: string | null,
): Promise<RespostaDaEvolution<InstanciaCriada>> {
  const so = numero?.replace(/\D/g, '');
  return chamar(credenciais, '/instance/create', {
    method: 'POST',
    body: {
      instanceName: credenciais.instance,
      qrcode: true,
      // Sem isto o aparelho manda só o punhado de mensagens mais recente,
      // que é o padrão do protocolo de aparelho vinculado. É esta linha
      // que faz a conversa inteira vir.
      syncFullHistory: true,
      // Com número, a criação já nasce pedindo código em vez de imagem —
      // evita uma segunda viagem só pra trocar o modo de pareamento.
      ...(so ? { number: so } : {}),
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

/**
 * Pede ao servidor que o aparelho mande o histórico ao parear.
 *
 * Separado da criação pelo mesmo motivo do webhook: criar acontece UMA
 * vez, e quem já pareou antes desta linha existir tem uma sessão gravada
 * com o pedido desligado. Sem esta chamada, essas empresas continuariam
 * recebendo só as mensagens novas pra sempre — e o defeito se
 * consertaria apenas pra quem conectasse do zero.
 *
 * Falhar aqui não é motivo pra derrubar a conexão: sem histórico o painel
 * funciona, só começa vazio.
 */
export function pedirHistoricoCompleto(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/settings/set/${credenciais.instance}`, {
    method: 'POST',
    body: { syncFullHistory: true },
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

/**
 * Pede o pareamento — por imagem ou por número.
 *
 * É a MESMA rota nos dois casos: informando `number`, a Evolution devolve
 * um código de oito caracteres em vez do QR code. Só os dígitos vão, e com
 * DDI: um número escrito com parênteses ou sem o 55 gera um código que
 * nunca funciona, sem erro nenhum — o WhatsApp simplesmente não encontra o
 * aparelho, e a espera some no vazio.
 */
export function conectar(
  credenciais: Credenciais,
  numero?: string | null,
): Promise<RespostaDaEvolution<InstanciaCriada>> {
  const so = numero?.replace(/\D/g, '');
  const caminho = `/instance/connect/${credenciais.instance}`;
  return chamar(credenciais, so ? `${caminho}?number=${so}` : caminho, {
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
