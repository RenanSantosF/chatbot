import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';
import { WhatsappSenderService } from '../whatsapp-sender.service';
import type {
  CanalDeMensagem,
  IdExterno,
  ModeloAprovado,
} from './canal.interface';

/**
 * A porta única por onde o sistema fala com o WhatsApp.
 *
 * Ele NÃO envia nada: descobre qual provedor atende esta empresa e repassa.
 * Toda a lógica de entrega mora nas implementações.
 *
 * Os nomes dos métodos são os mesmos que o serviço da Meta já expunha, e
 * isso foi de propósito: trocar a injeção no ConversationsService por esta
 * classe não mexeu em nenhuma das oito chamadas espalhadas por lá. Uma
 * mudança estrutural que se paga em uma linha de diff é uma mudança que
 * alguém consegue revisar.
 *
 * O provedor é lido do banco a cada requisição, e não guardado em memória
 * do processo: a empresa pode trocar de plano, e a próxima mensagem já sai
 * pelo caminho novo sem ninguém reiniciar nada.
 */
@Injectable()
export class CanalService {
  private readonly logger = new Logger(CanalService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly meta: WhatsappSenderService,
  ) {}

  /**
   * Quem atende esta empresa.
   *
   * Sem configuração de WhatsApp, cai no oficial — que é o que já
   * acontecia antes de existir escolha, e é o que devolve a mensagem de
   * "não conectado" que o painel sabe mostrar.
   */
  private async provedor(): Promise<CanalDeMensagem> {
    const config = await this.prisma.db.whatsAppSettings.findFirst({
      select: { provider: true },
    });

    if (config?.provider === 'EVOLUTION') {
      // A implementação entra aqui na etapa seguinte. Até lá, dizer a
      // verdade é melhor que fingir que enviou: cair no provedor errado
      // mandaria a mensagem por um canal que a empresa não escolheu.
      this.logger.error(
        `Tenant ${this.prisma.tenantId} está marcado como EVOLUTION, mas o provedor ainda não foi implementado.`,
      );
      this.ultimoUsado = new CanalIndisponivel(
        'o provedor de mensagens desta empresa ainda não está disponível',
      );
      return this.ultimoUsado;
    }

    this.ultimoUsado = this.meta;
    return this.meta;
  }

  async enviarTexto(
    para: string,
    texto: string,
    citando?: IdExterno | null,
  ): Promise<IdExterno | null> {
    return (await this.provedor()).enviarTexto(para, texto, citando);
  }

  async enviarReacao(
    para: string,
    mensagem: IdExterno,
    emoji: string,
  ): Promise<void> {
    return (await this.provedor()).enviarReacao(para, mensagem, emoji);
  }

  async marcarComoLida(mensagem: IdExterno): Promise<void> {
    return (await this.provedor()).marcarComoLida(mensagem);
  }

  async listarModelos(): Promise<ModeloAprovado[]> {
    return (await this.provedor()).listarModelos();
  }

  async enviarModelo(
    para: string,
    modelo: { name: string; language: string; bodyParams?: string[] },
  ): Promise<IdExterno> {
    return (await this.provedor()).enviarModelo(para, modelo);
  }

  /**
   * Envio de anexo — hoje só pela Meta, e por isso fora do contrato.
   *
   * Passa por aqui mesmo assim pra que o ConversationsService tenha UMA
   * porta só; se a mídia fosse pedida direto ao serviço da Meta, o dia em
   * que a Evolution enviar arquivo exigiria caçar chamada espalhada.
   *
   * O `mediaId` denuncia o vazamento: ele vem de um upload em duas etapas
   * que só existe na Cloud API. Quando o redesenho de mídia acontecer, é
   * esta assinatura que muda — e só ela.
   */
  async enviarMidia(
    para: string,
    tipo: 'image' | 'document' | 'audio' | 'video' | 'sticker',
    mediaId: string,
    opcoes: { caption?: string; filename?: string } = {},
  ): Promise<IdExterno | null> {
    this.ultimoUsado = this.meta;
    return this.meta.sendMedia(para, tipo, mediaId, opcoes);
  }

  /**
   * O motivo da última falha, vindo de quem tentou entregar.
   *
   * Cada implementação guarda o seu; aqui só devolvemos o de quem foi
   * usado por último nesta requisição. Sem o `ultimoUsado`, uma empresa na
   * Evolution mostraria o motivo guardado pelo serviço da Meta — que nem
   * chegou a ser chamado.
   */
  get motivoDaUltimaFalha(): string | null {
    return (this.ultimoUsado ?? this.meta).motivoDaUltimaFalha;
  }

  private ultimoUsado: CanalDeMensagem | null = null;
}

/**
 * O canal que não existe.
 *
 * Usado quando a empresa aponta pra um provedor que não está de pé. Recusa
 * tudo com um motivo legível, em vez de estourar exceção no meio do envio
 * — o chamador já sabe lidar com "não saiu", e a mensagem fica marcada como
 * falha com esse texto no balão.
 */
class CanalIndisponivel implements CanalDeMensagem {
  constructor(readonly motivoDaUltimaFalha: string) {}

  enviarTexto(): Promise<IdExterno | null> {
    return Promise.resolve(null);
  }

  enviarReacao(): Promise<void> {
    return Promise.resolve();
  }

  marcarComoLida(): Promise<void> {
    return Promise.resolve();
  }

  listarModelos(): Promise<ModeloAprovado[]> {
    return Promise.resolve([]);
  }

  enviarModelo(): Promise<IdExterno> {
    return Promise.reject(new Error(this.motivoDaUltimaFalha));
  }
}
