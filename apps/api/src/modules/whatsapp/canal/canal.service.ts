import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';
import { WhatsappSenderService } from '../whatsapp-sender.service';
import { EvolutionCanal } from './evolution/evolution.canal';
import type {
  ArquivoParaEnvio,
  CanalDeMensagem,
  EnvioDeMidia,
  IdExterno,
  MidiaBaixada,
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
    private readonly global: PrismaService,
    private readonly meta: WhatsappSenderService,
    private readonly evolution: EvolutionCanal,
  ) {}

  /**
   * Quem atende esta empresa.
   *
   * A escolha vem do Tenant, e não da configuração do WhatsApp oficial:
   * quem está na Evolution nunca cria aquela linha, então perguntar lá
   * responderia "oficial" pra todo mundo.
   *
   * Empresa que não existe mais (apagada no meio de uma requisição em
   * andamento) cai no oficial, que é o que devolve a mensagem de "não
   * conectado" que o painel sabe mostrar.
   */
  private async provedor(): Promise<CanalDeMensagem> {
    const tenant = await this.global.client.tenant.findUnique({
      where: { id: this.prisma.tenantId },
      select: { canal: true },
    });

    this.ultimoUsado = tenant?.canal === 'EVOLUTION' ? this.evolution : this.meta;
    return this.ultimoUsado;
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
   * Envio de anexo, agora de verdade nos dois caminhos.
   *
   * Este método já existiu recebendo um `mediaId` — o identificador do
   * upload em duas etapas da Cloud API — e por isso só sabia falar com a
   * Meta: numa empresa na Evolution ele recusava com "o envio de anexo
   * ainda não está disponível nesta conexão". Passando o ARQUIVO em vez do
   * identificador, cada provedor faz o que precisa por dentro, e o
   * chamador não sabe a diferença (ver canal.interface).
   */
  async enviarMidia(
    para: string,
    arquivo: ArquivoParaEnvio,
    opcoes: { caption?: string; citando?: IdExterno | null } = {},
  ): Promise<EnvioDeMidia> {
    return (await this.provedor()).enviarMidia(para, arquivo, opcoes);
  }

  /**
   * Busca o binário pelo handle que o envio ou o recebimento guardou.
   *
   * O provedor é o de HOJE, e não o de quando a mensagem foi gravada. Uma
   * empresa que migrou da Meta pra Evolution perde o acesso aos anexos
   * antigos por aqui — o `mediaId` da Meta não quer dizer nada pra
   * Evolution. Quem cobre esse caso é o arquivamento próprio (ver
   * StorageService), que guarda uma cópia justamente porque a origem não
   * dura pra sempre.
   */
  async baixarMidia(handle: string): Promise<MidiaBaixada | null> {
    return (await this.provedor()).baixarMidia(handle);
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

  enviarMidia(): Promise<EnvioDeMidia> {
    return Promise.resolve({ externalId: null, handle: null });
  }

  baixarMidia(): Promise<MidiaBaixada | null> {
    return Promise.resolve(null);
  }
}
