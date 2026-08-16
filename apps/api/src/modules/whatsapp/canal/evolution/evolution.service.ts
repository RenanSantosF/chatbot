import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { EncryptionService } from '../../../../common/crypto/encryption.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../../../common/prisma/tenant-prisma.service';
import * as evolution from './evolution.client';

/**
 * A tela de conectar o WhatsApp pela Evolution.
 *
 * O fluxo inteiro é: a empresa informa o servidor, a gente cria uma sessão
 * lá, mostra o QR code, e a pessoa lê com o celular. Da leitura em diante
 * quem avisa que deu certo é o webhook — este serviço nunca fica esperando
 * a conexão acontecer.
 *
 * Isso é de propósito. Ler o QR code leva de segundos a minutos (achar o
 * celular, abrir o menu certo), e uma requisição HTTP pendurada esse tempo
 * todo é uma requisição que o balanceador derruba no meio.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * O endereço que a Evolution vai chamar quando chegar mensagem.
   *
   * Precisa ser público: é um servidor de fora batendo aqui. Em
   * desenvolvimento isso quer dizer um túnel — e falhar cedo, com esta
   * mensagem, evita a hora perdida procurando por que "conectou mas não
   * chega nada".
   *
   * O `/api` NÃO é enfeite: toda a API vive sob esse prefixo global (ver
   * `setGlobalPrefix` em main.ts), e `API_PUBLIC_URL` guarda só o domínio.
   * Sem ele o endereço registrado na Evolution aponta pra uma rota que não
   * existe, ela entrega tudo em 404, e o sintoma é exatamente o que esta
   * função existe pra evitar: conecta, o QR code funciona, e nenhuma
   * mensagem aparece no painel.
   */
  private urlDoWebhook(secret: string): string {
    const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, '');
    if (!base) {
      throw new BadRequestException(
        'Configure API_PUBLIC_URL com o endereço público desta API antes de conectar: é para lá que o servidor de mensagens envia o que chega.',
      );
    }
    return `${base}/api/webhooks/evolution/${secret}`;
  }

  async status() {
    const config = await this.prisma.db.evolutionSettings.findFirst();
    if (!config) return null;

    return {
      baseUrl: config.baseUrl,
      instance: config.instance,
      estado: config.estado,
      qrCode: config.qrCode,
      connectedPhone: config.connectedPhone,
      lastSeenAt: config.lastSeenAt,
      lastError: config.lastError,
    };
  }

  /**
   * Cria a sessão no servidor e devolve o QR code.
   *
   * Guarda ANTES de chamar o servidor, e não depois. Se a criação der
   * certo lá e a gravação falhar aqui, fica uma sessão órfã consumindo
   * memória do servidor que ninguém sabe apagar — e o nome dela, que é
   * aleatório, se perde junto.
   */
  async conectar(dados: { baseUrl: string; apiKey: string }) {
    const existente = await this.prisma.db.evolutionSettings.findFirst();

    // O nome da sessão é sorteado, e não derivado do nome da empresa: ele
    // é único na plataforma inteira, e nome de empresa se repete. Uma vez
    // sorteado, nunca muda — trocá-lo abandonaria a sessão antiga no
    // servidor.
    const instance = existente?.instance ?? `inteliwa-${randomUUID()}`;
    const webhookSecret = existente?.webhookSecret ?? randomBytes(24).toString('hex');
    const apiKeyEncrypted = this.encryption.encrypt(dados.apiKey);
    const baseUrl = dados.baseUrl.replace(/\/+$/, '');

    const config = existente
      ? await this.prisma.db.evolutionSettings.update({
          where: { id: existente.id },
          data: {
            baseUrl,
            apiKeyEncrypted,
            estado: 'AGUARDANDO_QRCODE',
            qrCode: null,
            lastError: null,
          },
        })
      : await this.prisma.db.evolutionSettings.create({
          data: {
            tenantId: this.prisma.tenantId,
            baseUrl,
            apiKeyEncrypted,
            instance,
            webhookSecret,
            estado: 'AGUARDANDO_QRCODE',
          },
        });

    const credenciais = { baseUrl, apiKey: dados.apiKey, instance: config.instance };
    const url = this.urlDoWebhook(config.webhookSecret);

    // Criar dá 403 quando a sessão já existe. Não é erro: é o caso de quem
    // está reconectando depois de uma queda, e aí o caminho é pedir o QR
    // code da sessão que já está lá.
    let resposta = await evolution.criarInstancia(credenciais, url);
    if (!resposta.ok && resposta.status === 403) {
      resposta = await evolution.conectar(credenciais);
    }

    if (!resposta.ok) {
      await this.prisma.db.evolutionSettings.update({
        where: { id: config.id },
        data: { estado: 'DESCONECTADO', lastError: resposta.erro },
      });
      throw new BadRequestException(
        resposta.erro ?? 'Não deu pra criar a sessão no servidor de mensagens.',
      );
    }

    const qrCode = resposta.dados?.qrcode?.base64 ?? null;
    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: { qrCode, lastError: null },
    });

    this.logger.log(
      `Sessão ${config.instance} criada pro tenant ${this.prisma.tenantId}; aguardando leitura do QR code.`,
    );

    // A empresa passa a ser da Evolution assim que a sessão existe, e não
    // quando o QR code é lido: se a troca esperasse a conexão, as
    // mensagens do intervalo sairiam pela Meta, que é justamente o canal
    // que ela está deixando.
    await this.global.client.tenant.update({
      where: { id: this.prisma.tenantId },
      data: { canal: 'EVOLUTION' },
    });

    return { instance: config.instance, qrCode, estado: 'AGUARDANDO_QRCODE' as const };
  }

  /** Um QR code novo — o anterior expira em cerca de um minuto. */
  async renovarQrCode() {
    const { config, credenciais } = await this.credenciais();

    const resposta = await evolution.conectar(credenciais);
    if (!resposta.ok) {
      throw new BadRequestException(
        resposta.erro ?? 'Não deu pra gerar um QR code novo.',
      );
    }

    const qrCode = resposta.dados?.qrcode?.base64 ?? null;
    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: { qrCode, estado: 'AGUARDANDO_QRCODE', lastError: null },
    });

    return { qrCode };
  }

  /**
   * Confere no servidor em que pé está a sessão.
   *
   * Existe além do webhook porque o webhook pode ter se perdido — o
   * servidor reiniciou, a rede oscilou, a URL mudou. Sem esta conferência
   * sob demanda, o painel diria "conectado" para uma sessão que caiu horas
   * atrás, e ninguém entenderia por que as mensagens não saem.
   */
  async conferir() {
    const { config, credenciais } = await this.credenciais();

    const resposta = await evolution.estado(credenciais);
    if (!resposta.ok) {
      await this.prisma.db.evolutionSettings.update({
        where: { id: config.id },
        data: { lastError: resposta.erro },
      });
      return { estado: config.estado, lastError: resposta.erro };
    }

    const bruto = resposta.dados?.instance?.state;
    const estado =
      bruto === 'open'
        ? ('CONECTADO' as const)
        : bruto === 'connecting'
          ? ('AGUARDANDO_QRCODE' as const)
          : ('DESCONECTADO' as const);

    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado,
        lastError: null,
        ...(estado === 'CONECTADO' ? { lastSeenAt: new Date(), qrCode: null } : {}),
      },
    });

    return { estado, lastError: null };
  }

  /**
   * Desvincula o aparelho e volta a empresa pro canal oficial.
   *
   * A sessão é APAGADA no servidor, não só desconectada: sessão parada
   * continua ocupando memória lá, e uma que ninguém vai reconectar é só
   * custo. O registro daqui fica, com o nome da sessão, pra reconectar
   * depois sem sobrar órfã.
   */
  async desconectar() {
    const { config, credenciais } = await this.credenciais();

    await evolution.desconectar(credenciais);
    const apagada = await evolution.apagarInstancia(credenciais);
    if (!apagada.ok) {
      this.logger.warn(
        `Sessão ${config.instance} desconectada, mas não apagada no servidor: ${apagada.erro}`,
      );
    }

    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado: 'DESCONECTADO',
        qrCode: null,
        connectedPhone: null,
        lastError: null,
      },
    });
    await this.global.client.tenant.update({
      where: { id: this.prisma.tenantId },
      data: { canal: 'META_CLOUD' },
    });

    return { estado: 'DESCONECTADO' as const };
  }

  private async credenciais() {
    const config = await this.prisma.db.evolutionSettings.findFirst();
    if (!config) {
      throw new NotFoundException(
        'Esta empresa ainda não tem uma conexão com servidor de mensagens.',
      );
    }

    return {
      config,
      credenciais: {
        baseUrl: config.baseUrl,
        apiKey: this.encryption.decrypt(config.apiKeyEncrypted),
        instance: config.instance,
      },
    };
  }
}
