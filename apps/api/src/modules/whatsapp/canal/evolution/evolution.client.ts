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
  /*
   * Por onde chegam as conversas que JÁ existiam no aparelho.
   *
   * O nome é `MESSAGES_SET`, e não `MESSAGING_HISTORY_SET`. O segundo é
   * como o evento se chama DENTRO da Evolution, no Baileys; o que sai pelo
   * webhook é o primeiro. Assinar só o nome de dentro deixava o
   * pareamento trazer o telefone e mais nada — sem erro em lugar nenhum,
   * porque o servidor simplesmente não tinha esse evento pra mandar.
   *
   * E é SÓ ele. O servidor valida esta lista contra um enum e recusa a
   * chamada inteira quando encontra um nome que não conhece — não é um
   * item ignorado, é o registro do endereço de retorno que não acontece.
   * Mandar os dois nomes "por garantia" derrubava a conexão toda.
   */
  'MESSAGES_SET',
  // Apagar "para todos" no celular. Sem assinar, a mensagem sumia do
  // aparelho e continuava no painel — e o histórico passava a mostrar
  // como dito algo que a empresa retirou de propósito.
  'MESSAGES_DELETE',
];

/**
 * A agenda do aparelho. Assinada à parte, e não junto da lista acima.
 *
 * O motivo é a regra explicada ali em cima: o servidor confere a lista
 * contra um enum e RECUSA A CHAMADA INTEIRA quando encontra um nome que
 * não conhece. Como o conjunto de eventos varia entre versões da
 * Evolution, um nome que não exista na versão do cliente não deixaria
 * apenas os contatos de fora — derrubaria o registro do endereço de
 * retorno, e com ele o recebimento de TODA mensagem.
 *
 * Separados, dá pra tentar com eles e cair pra lista essencial se o
 * servidor recusar. Perder os nomes é ruim; perder as mensagens é o
 * produto parado.
 */
const EVENTOS_DE_CONTATO = ['CONTACTS_SET', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE'];

const EVENTOS_COM_CONTATOS = [...EVENTOS, ...EVENTOS_DE_CONTATO];

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
    /*
     * A lista de erros de validação vem com OBJETOS dentro.
     *
     * `join` chama `String()` em cada item, e `String({...})` é
     * "[object Object]" — que foi exatamente o que apareceu no log no
     * lugar do motivo de uma sessão não ter sido apagada. Um erro
     * ilegível custa mais que um erro feio: ele manda quem está
     * investigando procurar no lugar errado.
     */
    const texto = Array.isArray(bruto)
      ? bruto
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join('; ')
      : bruto;
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

/**
 * Quanto o servidor segura a mensagem antes de soltar, em milissegundos.
 *
 * NÃO É ENFEITE: a Evolution é um cliente NÃO OFICIAL do WhatsApp, e o
 * padrão que mais denuncia automação é a cadência. Um atendente humano
 * leva segundos entre uma mensagem e a seguinte; a IA respondendo dez
 * conversas ao mesmo tempo dispararia as dez no mesmo instante.
 *
 * Um segundo e meio é curto o bastante pra ninguém reclamar de lentidão no
 * atendimento e longo o bastante pra quebrar a rajada. Durante ele a
 * Evolution mantém o "digitando" aceso no aparelho do cliente, então o
 * tempo aparece como alguém escrevendo — não como travamento.
 */
const ESPERA_ANTES_DE_ENVIAR_MS = 1500;

export function enviarTexto(
  credenciais: Credenciais,
  envio: { numero: string; texto: string; citando?: string | null },
): Promise<RespostaDaEvolution<EnvioAceito>> {
  return chamar(credenciais, `/message/sendText/${credenciais.instance}`, {
    method: 'POST',
    body: {
      number: envio.numero,
      text: envio.texto,
      delay: ESPERA_ANTES_DE_ENVIAR_MS,
      // "composing" é o que acende o "digitando..." no aparelho de quem vai
      // receber, durante o `delay` acima. Sem ele a mensagem aparece do
      // nada depois de uma pausa — que é pior que os dois extremos.
      presence: 'composing',
      ...(envio.citando
        ? { quoted: { key: { id: envio.citando } } }
        : {}),
    },
  });
}

/** O que a Evolution devolve sobre um grupo. */
export interface GrupoDaEvolution {
  id?: string;
  /** O nome do grupo, como aparece no aparelho. */
  subject?: string;
  size?: number;
}

/**
 * O nome e o tamanho de um grupo.
 *
 * Serve pra o painel mostrar "Fornecedores" em vez de
 * `120363025343298765@g.us`, que é o que chega na mensagem — o evento de
 * mensagem NÃO traz o nome do grupo, só o endereço dele.
 *
 * Confirmado em `GroupJid` e na rota `GET /group/findGroupInfos` da v2. O
 * parâmetro vai na query, e não no corpo: a rota é GET.
 */
export function buscarGrupo(
  credenciais: Credenciais,
  groupJid: string,
): Promise<RespostaDaEvolution<GrupoDaEvolution>> {
  const query = new URLSearchParams({ groupJid }).toString();
  return chamar(
    credenciais,
    `/group/findGroupInfos/${credenciais.instance}?${query}`,
    { method: 'GET' },
  );
}

/** O que a Evolution responde ao conferir uma lista de números. */
export interface NumeroConferido {
  exists?: boolean;
  jid?: string;
  number?: string;
}

/**
 * Estes números existem no WhatsApp?
 *
 * Serve pra NÃO disparar pra número que não existe, e o motivo é de
 * sobrevivência da conta: mandar mensagem pra números inexistentes é o que
 * quem varre faixas de número faz, e é um dos sinais mais fortes de spam
 * que existe. Um dígito digitado errado no painel viraria exatamente esse
 * sinal.
 *
 * Confirmado em `WhatsAppNumberDto` e no uso do próprio servidor
 * (`isWA.exists`), na v2.
 */
export function conferirNumeros(
  credenciais: Credenciais,
  numeros: string[],
): Promise<RespostaDaEvolution<NumeroConferido[]>> {
  return chamar(credenciais, `/chat/whatsappNumbers/${credenciais.instance}`, {
    method: 'POST',
    body: { numbers: numeros },
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
        // Mesma cadência do texto (ver ESPERA_ANTES_DE_ENVIAR_MS): anexo
        // disparado no mesmo instante da mensagem anterior é o padrão que
        // denuncia automação.
        delay: ESPERA_ANTES_DE_ENVIAR_MS,
        ...(envio.legenda ? { caption: envio.legenda } : {}),
        ...(envio.citando ? { quoted: { key: { id: envio.citando } } } : {}),
      },
    },
  );
}

/**
 * Envia uma FIGURINHA.
 *
 * Rota separada porque a diferença aparece no aparelho do cliente: por
 * aqui o WebP chega como figurinha — fundo transparente, sem moldura, no
 * tamanho de figurinha — e por `sendMedia` chegaria como uma foto comum
 * com fundo branco. Era o que acontecia: o código mandava
 * `tipo: 'sticker'` pra rota de imagem e o efeito se perdia no caminho.
 *
 * O corpo tem um campo só (`sticker`), e não os quatro do envio de mídia:
 * a Evolution converte o que receber, e por isso não pergunta mimetype
 * nem nome de arquivo. Confirmado em `SendStickerDto` na v2.
 */
export function enviarFigurinha(
  credenciais: Credenciais,
  envio: { numero: string; base64: string; citando?: string | null },
): Promise<RespostaDaEvolution<EnvioAceito>> {
  return chamar(credenciais, `/message/sendSticker/${credenciais.instance}`, {
    method: 'POST',
    tempoLimiteMs: TEMPO_LIMITE_MIDIA_MS,
    body: {
      number: envio.numero,
      sticker: envio.base64,
      ...(envio.citando ? { quoted: { key: { id: envio.citando } } } : {}),
    },
  });
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
        delay: ESPERA_ANTES_DE_ENVIAR_MS,
        // "recording" e não "composing": no aparelho do cliente aparece
        // "gravando áudio...", que é o que de fato está por vir.
        presence: 'recording',
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
  /**
   * O bloco de mídia que veio na mensagem, quando ele foi guardado.
   *
   * Muda QUAL das duas coisas a Evolution faz. Só com a chave, ela
   * procura a mensagem no banco dela e responde "Message not found"
   * quando não acha — o caso de toda conversa que já estava no aparelho
   * antes de conectar, que chegou pela sincronização e ela nunca teve.
   * Com o bloco junto, ela pula a busca e baixa direto do WhatsApp com o
   * endereço criptografado que está aqui dentro.
   */
  midia?: Record<string, unknown> | null,
): Promise<RespostaDaEvolution<MidiaEmBase64>> {
  return chamar(
    credenciais,
    `/chat/getBase64FromMediaMessage/${credenciais.instance}`,
    {
      method: 'POST',
      tempoLimiteMs: TEMPO_LIMITE_MIDIA_MS,
      body: {
        message: { key: chave, ...(midia ? { message: midia } : {}) },
        convertToMp4: false,
      },
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
function registrar(
  credenciais: Credenciais,
  webhookUrl: string,
  events: string[],
): Promise<RespostaDaEvolution> {
  return chamar(credenciais, `/webhook/set/${credenciais.instance}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events,
      },
    },
  });
}

export async function definirWebhook(
  credenciais: Credenciais,
  webhookUrl: string,
): Promise<RespostaDaEvolution> {
  const comContatos = await registrar(
    credenciais,
    webhookUrl,
    EVENTOS_COM_CONTATOS,
  );
  if (comContatos.ok) return comContatos;

  /*
   * O servidor recusou a lista inteira. Tenta sem os contatos.
   *
   * A recusa é tudo-ou-nada (ver EVENTOS_DE_CONTATO), e a versão da
   * Evolution do cliente pode não conhecer esses nomes. Insistir seria
   * trocar "o painel mostra telefone em vez de nome" por "o painel não
   * recebe mensagem nenhuma" — e o segundo é o produto parado.
   *
   * Quem chama continua recebendo o resultado desta segunda tentativa,
   * então uma falha de verdade (endereço errado, chave recusada) segue
   * subindo como antes.
   */
  return registrar(credenciais, webhookUrl, EVENTOS);
}

/**
 * A agenda que o servidor já tem guardada.
 *
 * Existe porque o evento de agenda chega UMA vez, no pareamento: quem já
 * está conectado não o recebe de novo, e uma empresa que pareou antes de
 * a importação funcionar ficaria sem os nomes pra sempre — a menos que
 * desconectasse e lesse o QR code outra vez, o que é caro demais pra pedir.
 *
 * O formato do que volta é o mesmo do webhook (`remoteJid`, `pushName`),
 * então quem consome é a mesma função (ver `importarAgenda`).
 */
export function buscarContatos(
  credenciais: Credenciais,
): Promise<RespostaDaEvolution<ContatoGuardado[]>> {
  return chamar(credenciais, `/chat/findContacts/${credenciais.instance}`, {
    method: 'POST',
    body: { where: {} },
  });
}

export interface ContatoGuardado {
  id?: string;
  remoteJid?: string;
  pushName?: string;
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
  // O servidor exige a configuração INTEIRA, não um campo só: mandar
  // apenas `syncFullHistory` é recusado com "instance requires property"
  // pra cada um dos que faltam. Os valores abaixo são os padrões dele —
  // o único que muda de fato é o histórico.
  return chamar(credenciais, `/settings/set/${credenciais.instance}`, {
    method: 'POST',
    body: {
      rejectCall: false,
      msgCall: '',
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: true,
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
