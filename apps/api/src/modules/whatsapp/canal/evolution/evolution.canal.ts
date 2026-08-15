import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../../../common/prisma/tenant-prisma.service';
import type {
  CanalDeMensagem,
  IdExterno,
  ModeloAprovado,
} from '../canal.interface';
import * as evolution from './evolution.client';
import {
  desempacotarId,
  empacotarId,
  jidDoTelefone,
} from './evolution-id';

/**
 * O WhatsApp pela Evolution — sem Meta no meio.
 *
 * Ela conversa com o WhatsApp pelo mesmo protocolo do WhatsApp Web: um
 * aparelho vinculado por QR code. Não existe conta comercial, não existe
 * análise de app, não existe cobrança por conversa. O preço é outro: a
 * sessão cai, o número pode ser bloqueado pela Meta, e não há modelo
 * aprovado — ou seja, não há jeito oficial de puxar conversa com quem não
 * falou primeiro.
 *
 * Esse último ponto muda o produto, não só o código, e por isso está
 * escrito por extenso em `listarModelos` e `enviarModelo`.
 */
@Injectable()
export class EvolutionCanal implements CanalDeMensagem {
  private readonly logger = new Logger(EvolutionCanal.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private ultimaFalha: string | null = null;

  get motivoDaUltimaFalha(): string | null {
    return this.ultimaFalha;
  }

  /**
   * As credenciais do servidor desta empresa.
   *
   * Devolve `null` — e não lança — quando a empresa está marcada na
   * Evolution mas nunca conectou. É o mesmo caso do "WhatsApp não está
   * conectado" do caminho oficial, e quem chama já sabe tratar.
   */
  private async credenciais(): Promise<evolution.Credenciais | null> {
    const config = await this.prisma.db.evolutionSettings.findFirst();
    if (!config) {
      this.ultimaFalha = 'o WhatsApp não está conectado nesta empresa';
      return null;
    }

    // Sessão no chão não é falha de rede, e a diferença importa pra quem
    // atende: "reconecte lendo o QR code" é uma ação; "não deu pra falar
    // com o servidor" é esperar. Sem esta conferência, tentar enviar com a
    // sessão caída devolveria um erro de protocolo ilegível.
    if (config.estado !== 'CONECTADO') {
      this.ultimaFalha =
        config.estado === 'AGUARDANDO_QRCODE'
          ? 'o WhatsApp está aguardando a leitura do QR code'
          : 'o WhatsApp desta empresa está desconectado';
      return null;
    }

    return {
      baseUrl: config.baseUrl,
      apiKey: this.encryption.decrypt(config.apiKeyEncrypted),
      instance: config.instance,
    };
  }

  async enviarTexto(
    para: string,
    texto: string,
    citando?: IdExterno | null,
  ): Promise<IdExterno | null> {
    this.ultimaFalha = null;

    const credenciais = await this.credenciais();
    if (!credenciais) return null;

    const resposta = await evolution.enviarTexto(credenciais, {
      numero: para.replace(/\D/g, ''),
      texto,
      // A citação vai só com o id: quem cita já está na mesma conversa, e
      // o resto da chave é redundante ali.
      citando: citando ? (desempacotarId(citando)?.id ?? citando) : null,
    });

    if (!resposta.ok) {
      this.ultimaFalha = resposta.erro ?? 'o envio foi recusado';
      this.logger.error(
        `Falha ao enviar pela Evolution (tenant ${this.prisma.tenantId}): ${resposta.erro}`,
      );
      return null;
    }

    const chave = resposta.dados?.key;
    if (!chave?.id || !chave.remoteJid) {
      // Aceitou mas não disse qual é a mensagem. Não é falha de entrega —
      // ela saiu — mas sem id nenhum evento de status vai achar esta
      // linha, e o balão fica com um tique pra sempre.
      this.logger.warn(
        'A Evolution aceitou a mensagem sem devolver a chave; o status de entrega não vai chegar.',
      );
      return null;
    }

    return empacotarId({
      remoteJid: chave.remoteJid,
      fromMe: chave.fromMe ?? true,
      id: chave.id,
    });
  }

  async enviarReacao(
    para: string,
    mensagem: IdExterno,
    emoji: string,
  ): Promise<void> {
    const credenciais = await this.credenciais();
    if (!credenciais) return;

    const chave = desempacotarId(mensagem);
    if (!chave) {
      this.logger.warn(`Reação ignorada: id externo em formato antigo (${mensagem}).`);
      return;
    }

    const resposta = await evolution.enviarReacao(credenciais, {
      ...chave,
      // O JID guardado pode ser o do aparelho (com sufixo de dispositivo);
      // o telefone da conversa é a fonte mais confiável.
      remoteJid: jidDoTelefone(para),
      emoji,
    });
    if (!resposta.ok) {
      this.logger.warn(`Não deu pra reagir pela Evolution: ${resposta.erro}`);
    }
  }

  async marcarComoLida(mensagem: IdExterno): Promise<void> {
    const credenciais = await this.credenciais();
    if (!credenciais) return;

    const chave = desempacotarId(mensagem);
    if (!chave) return;

    const resposta = await evolution.marcarComoLida(credenciais, chave);
    if (!resposta.ok) {
      this.logger.warn(`Não deu pra marcar como lida pela Evolution: ${resposta.erro}`);
    }
  }

  /**
   * Vazia, e não é falta de implementação.
   *
   * Modelo aprovado é uma invenção da plataforma oficial, não do WhatsApp:
   * a Meta exige que toda primeira mensagem passe por um texto que ela
   * aprovou antes. Do lado da Evolution esse conceito não existe — dá pra
   * escrever qualquer coisa a qualquer hora.
   *
   * A lista vazia é o que faz a tela de "iniciar conversa" esconder o
   * seletor de modelo sozinha, sem ninguém escrever um `if` de provedor no
   * painel.
   */
  listarModelos(): Promise<ModeloAprovado[]> {
    return Promise.resolve([]);
  }

  /**
   * Recusa, com o motivo verdadeiro.
   *
   * Poderia mandar o texto do modelo como mensagem comum — e seria pior:
   * quem clicou escolheu um modelo esperando a proteção que ele dá (texto
   * conferido, sem risco de reclamação), e receberia um envio livre sem
   * saber. Recusar é o que deixa a tela oferecer o caminho certo: escrever
   * a mensagem à mão.
   */
  enviarModelo(): Promise<IdExterno> {
    return Promise.reject(
      new Error(
        'Modelos aprovados só existem no WhatsApp oficial. Nesta conexão, escreva a mensagem direto.',
      ),
    );
  }
}
