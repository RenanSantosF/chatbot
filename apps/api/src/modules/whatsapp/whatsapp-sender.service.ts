import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type {
  ArquivoParaEnvio,
  CanalDeMensagem,
  EnvioDeMidia,
  MidiaBaixada,
  ModeloAprovado,
} from './canal/canal.interface';
import { WhatsappMediaService } from './whatsapp-media.service';
import { motivoDaMeta } from './meta-erro';
import { postarTexto } from './meta-texto';

const GRAPH_API_VERSION = 'v21.0';
// Mesma base sobrescrevível do serviço de mídia (ver whatsapp-media.service):
// aponta num ambiente de teste da Meta ou num servidor de mentira durante
// teste automatizado. Em produção fica no padrão.
const GRAPH_BASE = process.env.META_GRAPH_URL ?? 'https://graph.facebook.com';

/**
 * Manda mensagem de saída pra Cloud API da Meta usando as credenciais do
 * próprio tenant (nunca uma chave compartilhada da plataforma) — mesmo
 * padrão de isolamento da API key da IA. Chamado pelo ConversationsService
 * sempre que a IA ou um atendente responde numa conversa cujo canal é
 * WHATSAPP; nunca lança erro pra fora, porque uma falha de envio (token
 * expirado, número sem permissão, etc.) não pode derrubar o fluxo interno
 * de conversa — a mensagem já foi salva e aparece no painel de qualquer
 * jeito, só não chega no telefone do cliente.
 *
 * É uma das implementações de `CanalDeMensagem` — a oficial. Os nomes dos
 * métodos seguem o contrato, e não o vocabulário da Meta, porque quem chama
 * não deve saber de quem está falando. `sendMedia` continua público porque
 * é a etapa crua da Cloud API (enviar citando um `mediaId` já subido); o
 * contrato é `enviarMidia`, que faz as duas etapas de uma vez.
 */
@Injectable()
export class WhatsappSenderService implements CanalDeMensagem {
  private readonly logger = new Logger(WhatsappSenderService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
    private readonly midia: WhatsappMediaService,
  ) {}

  /**
   * As duas etapas da Cloud API, escondidas atrás do contrato.
   *
   * Aqui o `mediaId` vira o `handle`: sobe o binário, recebe um id, e
   * manda a mensagem citando aquele id. É esse mesmo id que volta em
   * `baixarMidia` — a Meta hospeda o arquivo por 30 dias.
   */
  async enviarMidia(
    para: string,
    arquivo: ArquivoParaEnvio,
    opcoes: { caption?: string } = {},
  ): Promise<EnvioDeMidia> {
    this.ultimaFalha = null;

    // `upload` lança com o motivo da Meta quando ela recusa o arquivo — e
    // esse motivo é útil demais pra virar um "não deu certo" genérico.
    const mediaId = await this.midia.upload({
      buffer: arquivo.buffer,
      mimetype: arquivo.mimetype,
      originalname: arquivo.filename,
    });
    if (!mediaId) {
      this.ultimaFalha =
        'a Meta aceitou o arquivo mas não devolveu o identificador dele';
      return { externalId: null, handle: null };
    }

    const externalId = await this.sendMedia(para, arquivo.tipo, mediaId, {
      caption: opcoes.caption,
      filename: arquivo.filename,
    });

    // O handle sai mesmo quando a entrega falha: o binário está hospedado
    // e o painel consegue mostrar o que foi tentado.
    return { externalId, handle: mediaId };
  }

  baixarMidia(handle: string): Promise<MidiaBaixada | null> {
    return this.midia.download(handle).catch(() => null);
  }

  /**
   * Devolve o wamid da mensagem na Meta quando o envio dá certo (e null em
   * qualquer falha) — é por esse id que os webhooks de status depois
   * encontram a mensagem pra marcar entregue/lida no painel.
   */
  async enviarTexto(
    to: string,
    body: string,
    replyToExternalId?: string | null,
  ): Promise<string | null> {
    this.ultimaFalha = null;

    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      // O motivo é guardado, e não só registrado no log: canal
      // desconectado é a falha que mais engana quem atende, porque tudo do
      // lado de cá parece ter funcionado.
      this.ultimaFalha = 'o WhatsApp não está conectado nesta empresa';
      this.logger.warn(
        `Tenant ${this.prisma.tenantId} sem WhatsApp conectado — mensagem não enviada.`,
      );
      return null;
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);

    this.logger.log(
      `Enviando mensagem via WhatsApp: phoneNumberId=${settings.phoneNumberId}, to=${to}`,
    );

    // A chamada em si mora em `meta-texto` porque o encerramento
    // automático também precisa dela, e aquele é uma rotina de fundo que
    // não pode injetar um serviço de escopo de requisição.
    const { wamid, erro, corpo, status } = await postarTexto({
      phoneNumberId: settings.phoneNumberId,
      accessToken,
      to,
      body,
      replyToExternalId,
    });

    if (erro) {
      // Com corpo, sai o texto que a Meta escreveu; sem corpo (rede caiu
      // antes de haver resposta), sai o motivo da exceção.
      this.ultimaFalha = corpo
        ? motivoDaMeta(corpo, status ?? 0)
        : `não deu pra falar com a Meta (${erro})`;
      this.logger.error(`Falha ao enviar mensagem via WhatsApp: ${erro}`);
      return null;
    }

    this.logger.log(`Mensagem enviada via WhatsApp com sucesso: ${wamid}`);
    return wamid;
  }

  /**
   * Envia um template aprovado. É o único jeito de falar com alguém fora
   * da janela de 24 horas — depois desse prazo a Meta recusa texto livre,
   * então "iniciar conversa" sempre passa por aqui.
   *
   * Diferente dos outros envios, este PROPAGA o erro: quem inicia uma
   * conversa precisa saber na hora que o template foi recusado, senão
   * ficaria olhando pra uma conversa vazia sem entender o motivo.
   */
  async enviarModelo(
    to: string,
    template: { name: string; language: string; bodyParams?: string[] },
  ): Promise<string> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      throw new Error('WhatsApp não está conectado nesta empresa.');
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const url = `${GRAPH_BASE}/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`;

    const components = template.bodyParams?.length
      ? [
          {
            type: 'body',
            parameters: template.bodyParams.map((text) => ({
              type: 'text',
              text,
            })),
          },
        ]
      : undefined;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          ...(components ? { components } : {}),
        },
      }),
    });

    const payload = (await response.json()) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };

    if (!response.ok) {
      const detail = payload.error?.message ?? 'motivo não informado';
      this.logger.error(`Falha ao enviar template ${template.name}: ${detail}`);
      throw new Error(`A Meta recusou o template: ${detail}`);
    }

    return payload.messages?.[0]?.id ?? '';
  }

  /** Templates aprovados da conta, pra montar a tela de iniciar conversa. */
  async listarModelos(): Promise<ModeloAprovado[]> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings?.wabaId) {
      throw new Error(
        'Informe o ID da conta comercial (WABA) em Configurações > WhatsApp pra listar os templates.',
      );
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const response = await fetch(
      `${GRAPH_BASE}/${GRAPH_API_VERSION}/${settings.wabaId}/message_templates?limit=100&status=APPROVED`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const payload = (await response.json()) as {
      data?: {
        name: string;
        language: string;
        status: string;
        components?: { type: string; text?: string }[];
      }[];
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Não deu pra listar os templates.');
    }

    return (payload.data ?? []).map((template) => {
      const body =
        template.components?.find((part) => part.type === 'BODY')?.text ?? '';
      // {{1}}, {{2}}... são os buracos que a empresa preenche na hora do
      // envio; contar aqui evita a tela ter que reimplementar o parser.
      const placeholders = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
      return {
        name: template.name,
        language: template.language,
        body,
        placeholders,
      };
    });
  }

  /**
   * Envia uma mídia já hospedada na Meta (ver WhatsappMediaService.upload).
   * `kind` decide o campo do payload — a Cloud API não aceita um "anexo"
   * genérico, cada tipo tem o seu, e só `document` aceita filename.
   *
   * Fora do contrato `CanalDeMensagem` porque depende do `mediaId` que só a
   * Meta tem. Quem envia anexo ainda fala com este serviço direto.
   */
  async sendMedia(
    to: string,
    kind: 'image' | 'document' | 'audio' | 'video' | 'sticker',
    mediaId: string,
    options: { caption?: string; filename?: string } = {},
  ): Promise<string | null> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      this.logger.warn(
        `Tenant ${this.prisma.tenantId} sem WhatsApp conectado — mídia não enviada.`,
      );
      return null;
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    // Áudio e figurinha não aceitam legenda, e só documento aceita nome de
    // arquivo. Mandar um campo a mais faz a Meta recusar a mensagem inteira
    // com erro de parâmetro — não é tolerância, é rejeição.
    const media: Record<string, string> = { id: mediaId };
    const aceitaLegenda = kind !== 'audio' && kind !== 'sticker';
    if (options.caption && aceitaLegenda) media.caption = options.caption;
    if (options.filename && kind === 'document') media.filename = options.filename;

    try {
      const response = await fetch(
        `${GRAPH_BASE}/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: kind,
            [kind]: media,
          }),
        },
      );

      const responseBody = await response.text();
      if (!response.ok) {
        this.logger.error(
          `Falha ao enviar mídia via WhatsApp (${response.status}): ${responseBody}`,
        );
        // O motivo volta pra quem chamou gravar junto da mensagem. Sem isso
        // o atendente via só o triângulo vermelho e não tinha como saber se
        // o problema era o arquivo, o número do cliente ou o token.
        this.ultimaFalha = motivoDaMeta(responseBody, response.status);
        return null;
      }
      this.ultimaFalha = null;
      return this.extractMessageId(responseBody);
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error);
      this.logger.error(`Erro de rede ao enviar mídia via WhatsApp: ${detalhe}`);
      this.ultimaFalha = `não deu pra falar com a Meta (${detalhe})`;
      return null;
    }
  }

  /**
   * Motivo da última recusa de envio de mídia.
   *
   * Guardado no serviço porque `sendMedia` promete `string | null` pra meia
   * dúzia de chamadores e mudar a assinatura por causa de um caso de erro
   * espalharia tratamento por todos eles. O serviço tem escopo de
   * requisição (TenantPrismaService), então isto não vaza entre pedidos
   * simultâneos — cada requisição tem a sua instância.
   */
  private ultimaFalha: string | null = null;

  get motivoDaUltimaFalha(): string | null {
    return this.ultimaFalha;
  }

  /**
   * Acende o tique azul no aparelho do cliente. A Meta exige o wamid da
   * mensagem recebida; não existe "marcar a conversa toda", marcar a mais
   * recente já marca as anteriores.
   */
  async marcarComoLida(messageId: string): Promise<void> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) return;

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    try {
      const response = await fetch(
        `${GRAPH_BASE}/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          }),
        },
      );
      if (!response.ok) {
        this.logger.warn(
          `Não deu pra marcar como lida (${response.status}): ${await response.text()}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Erro de rede ao marcar como lida: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Reage a uma mensagem do cliente. Emoji vazio remove a reação. */
  async enviarReacao(to: string, messageId: string, emoji: string): Promise<void> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) return;

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    try {
      await fetch(
        `${GRAPH_BASE}/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'reaction',
            reaction: { message_id: messageId, emoji },
          }),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Erro ao enviar reação: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private extractMessageId(responseBody: string): string | null {
    try {
      const parsed = JSON.parse(responseBody) as {
        messages?: { id?: string }[];
      };
      return parsed.messages?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}
