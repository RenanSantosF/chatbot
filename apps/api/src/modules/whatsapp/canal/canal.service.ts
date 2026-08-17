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
   * Quem atende esta empresa: a Evolution, sempre.
   *
   * Houve um tempo em que isto escolhia entre dois provedores, lendo um
   * campo `canal` no Tenant. A escolha foi retirada do produto: o caminho
   * oficial da Meta exige verificação de negócio, análise de app e modelo
   * aprovado, e enquanto essa burocracia não sai ele não é uma opção que
   * alguém possa usar — só uma porta pela qual dava pra cair sem querer.
   *
   * E caía. Aquele campo só era escrito ao conectar e ao desconectar, então
   * atrasava: a tela mostrava "Conectado", o que chegava entrava pelo
   * webhook, e só o ENVIO ia parar no provedor oficial, que não tem
   * credencial nenhuma e recusa. Um caminho que nunca é escolhido não
   * precisa existir na decisão.
   *
   * Quem não tem sessão pareada NÃO cai em lugar nenhum: a própria
   * Evolution recusa com um motivo legível ("ainda não foi conectado",
   * "desconectado", "aguardando a leitura do QR code"), que é o que o
   * balão mostra a quem atende. Silêncio nunca é resposta melhor que um
   * motivo.
   *
   * O serviço da Meta segue no código, exportado e testado, para o dia em
   * que a aprovação sair — mas nenhuma mensagem chega até ele por aqui.
   */
  private provedor(): CanalDeMensagem {
    this.ultimoUsado = this.evolution;
    return this.evolution;
  }

  enviarTexto(
    para: string,
    texto: string,
    citando?: IdExterno | null,
  ): Promise<IdExterno | null> {
    return this.provedor().enviarTexto(para, texto, citando);
  }

  enviarReacao(para: string, mensagem: IdExterno, emoji: string): Promise<void> {
    return this.provedor().enviarReacao(para, mensagem, emoji);
  }

  marcarComoLida(mensagem: IdExterno): Promise<void> {
    return this.provedor().marcarComoLida(mensagem);
  }

  listarModelos(): Promise<ModeloAprovado[]> {
    return this.provedor().listarModelos();
  }

  enviarModelo(
    para: string,
    modelo: { name: string; language: string; bodyParams?: string[] },
  ): Promise<IdExterno> {
    return this.provedor().enviarModelo(para, modelo);
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
  enviarMidia(
    para: string,
    arquivo: ArquivoParaEnvio,
    opcoes: { caption?: string; citando?: IdExterno | null } = {},
  ): Promise<EnvioDeMidia> {
    return this.provedor().enviarMidia(para, arquivo, opcoes);
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
  baixarMidia(handle: string): Promise<MidiaBaixada | null> {
    return this.provedor().baixarMidia(handle);
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
    return (this.ultimoUsado ?? this.evolution).motivoDaUltimaFalha;
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
