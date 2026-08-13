import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Conecta o WhatsApp do cliente sem que ele abra o Meta Developers.
 *
 * É a diferença entre vender e não vender: no caminho manual o cliente
 * precisa criar um app na Meta, gerar token e copiar três campos. Ninguém
 * que contrata um sistema de atendimento quer fazer isso — e a alternativa,
 * a gente fazer por ele, significa pedir a senha do Facebook dele.
 *
 * Aqui ele clica um botão, autoriza numa janela do próprio Facebook, e o
 * resto acontece deste lado com um token que a Meta devolve pra gente.
 *
 * A contrapartida é que a PLATAFORMA precisa ser Tech Provider aprovada:
 * verificação de negócio, App Review com vídeos e as permissões
 * `whatsapp_business_messaging` e `whatsapp_business_management`. O cliente
 * continua não precisando de nada.
 */
@Injectable()
export class EmbeddedSignupService {
  private readonly logger = new Logger(EmbeddedSignupService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * O que a tela precisa saber pra abrir a janela da Meta. Só identificadores
   * públicos — o segredo do app nunca sai daqui.
   */
  configuracaoPublica() {
    const appId = process.env.META_APP_ID;
    const configId = process.env.META_ES_CONFIG_ID;

    return {
      disponivel: Boolean(appId && configId && process.env.META_APP_SECRET),
      appId: appId ?? null,
      configId: configId ?? null,
      versao: GRAPH_API_VERSION,
    };
  }

  /**
   * Fecha a conexão depois que o cliente autorizou.
   *
   * São três chamadas na Meta, e a ordem importa: sem assinar os webhooks
   * da conta dele, mensagem nenhuma chega aqui; sem registrar o número, não
   * dá pra enviar. Fazer na ordem errada deixa o cliente "conectado" e mudo.
   *
   * @param code   código de troca do Embedded Signup — vale 30 segundos
   */
  async concluir(entrada: {
    code: string;
    wabaId: string;
    phoneNumberId: string;
    businessId?: string;
  }) {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new BadRequestException(
        'A plataforma ainda não está configurada como Tech Provider da Meta.',
      );
    }

    const token = await this.trocarCodigoPorToken(entrada.code, appId, appSecret);
    await this.assinarWebhooksDaConta(entrada.wabaId, token);
    const pin = await this.registrarNumero(entrada.phoneNumberId, token);
    const numero = await this.lerNumero(entrada.phoneNumberId, token);

    const existente = await this.prisma.db.whatsAppSettings.findFirst();
    const dados = {
      phoneNumberId: entrada.phoneNumberId,
      displayPhoneNumber: numero.display_phone_number ?? null,
      wabaId: entrada.wabaId,
      businessId: entrada.businessId ?? null,
      accessTokenEncrypted: this.encryption.encrypt(token),
      // Não guardamos segredo de app por cliente: quem assina os webhooks
      // agora é o app da plataforma.
      appSecretEncrypted: null,
      registrationPinEncrypted: pin ? this.encryption.encrypt(pin) : null,
      onboarding: 'EMBEDDED_SIGNUP' as const,
    };

    const settings = existente
      ? await this.prisma.db.whatsAppSettings.update({
          where: { id: existente.id },
          data: dados,
        })
      : await this.prisma.db.whatsAppSettings.create({
          data: { tenantId: this.prisma.tenantId, ...dados },
        });

    this.logger.log(
      `WhatsApp conectado por Embedded Signup: tenant ${this.prisma.tenantId}, número ${entrada.phoneNumberId}.`,
    );
    return settings;
  }

  /**
   * Lê a resposta da Meta sem confiar que ela é JSON.
   *
   * Nem sempre é: proxy, gateway e a própria borda da Meta devolvem HTML ou
   * texto puro quando algo dá errado no meio do caminho. Chamar `.json()`
   * direto transformava isso num 500 opaco — o erro real ("DNS resolution
   * failed") ficava só no log, e quem clicou via "Internal server error".
   */
  private async lerResposta(resposta: Response) {
    const texto = await resposta.text();
    try {
      return JSON.parse(texto) as {
        access_token?: string;
        error?: { message?: string };
      };
    } catch {
      return {
        error: {
          message: resposta.ok
            ? 'A Meta respondeu num formato inesperado.'
            : `A Meta recusou a conexão (HTTP ${resposta.status}).`,
        },
      };
    }
  }

  private async trocarCodigoPorToken(code: string, appId: string, appSecret: string) {
    const url = new URL(`${GRAPH}/oauth/access_token`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('code', code);

    const resposta = await fetch(url, { method: 'GET' });
    const corpo = await this.lerResposta(resposta);

    if (!resposta.ok || !corpo.access_token) {
      // O código vale 30 segundos. Expirar é o erro mais provável aqui, e
      // "tente de novo" é de fato a saída — por isso o recado é esse.
      throw new BadRequestException(
        corpo.error?.message ??
          'A autorização expirou antes de ser concluída. Clique em conectar e refaça.',
      );
    }
    return corpo.access_token;
  }

  /**
   * Sem isto o número fica conectado e mudo: a Meta só entrega webhook de
   * uma conta para os apps inscritos nela.
   */
  private async assinarWebhooksDaConta(wabaId: string, token: string) {
    const resposta = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resposta.ok) {
      const corpo = await this.lerResposta(resposta);
      throw new BadRequestException(
        corpo.error?.message ??
          'Não deu pra inscrever o sistema nas mensagens dessa conta.',
      );
    }
  }

  /**
   * Registra o número pra Cloud API, definindo o PIN da verificação em duas
   * etapas.
   *
   * Falhar aqui NÃO derruba a conexão de propósito: o caso comum é o número
   * já ter um PIN definido no aplicativo, e nesse cenário ele continua
   * funcionando. Abortar tudo por isso obrigaria o cliente a refazer a
   * autorização inteira por causa de um passo que talvez nem fosse preciso.
   */
  private async registrarNumero(phoneNumberId: string, token: string) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const resposta = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });

    if (!resposta.ok) {
      const corpo = await this.lerResposta(resposta);
      this.logger.warn(
        `Registro do número ${phoneNumberId} não concluído: ${corpo.error?.message ?? resposta.status}. Seguindo — o número pode já estar registrado.`,
      );
      return null;
    }
    return pin;
  }

  private async lerNumero(phoneNumberId: string, token: string) {
    const resposta = await fetch(
      `${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resposta.ok) return {};
    return (await this.lerResposta(resposta)) as {
      display_phone_number?: string;
      verified_name?: string;
    };
  }
}
