import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../../../common/prisma/tenant-prisma.service';
import type {
  ArquivoParaEnvio,
  CanalDeMensagem,
  EnvioDeMidia,
  IdExterno,
  MidiaBaixada,
  ModeloAprovado,
} from '../canal.interface';
import * as evolution from './evolution.client';
import type { DadosDaMensagem } from './evolution-mensagem';
import type { Citada } from './evolution.client';
import {
  desempacotarId,
  ehGrupo,
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

/** O que o WhatsApp escreve na tarjinha de um anexo citado sem legenda. */
const ROTULO_DO_ANEXO: Partial<Record<string, string>> = {
  IMAGE: '📷 Foto',
  VIDEO: '🎥 Vídeo',
  AUDIO: '🎤 Áudio',
  DOCUMENT: '📄 Documento',
};

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
      this.ultimaFalha = 'o WhatsApp desta empresa ainda não foi conectado';
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

  /**
   * Este número existe no WhatsApp?
   *
   * `null` quer dizer "não deu pra conferir" — servidor fora do ar, sessão
   * caída —, e é diferente de `false`. Quem chama precisa dessa distinção:
   * barrar o envio porque a conferência falhou seria transformar uma
   * indisponibilidade nossa em "esse cliente não existe".
   *
   * Existe por causa do risco de bloqueio: disparar pra número inexistente
   * é o que quem varre faixas de número faz, e é dos sinais mais fortes de
   * spam que existem. Como a Evolution é um cliente NÃO OFICIAL, a conta
   * pode ser bloqueada por padrão de comportamento — e um dígito digitado
   * errado no painel produz exatamente esse padrão.
   */
  async numeroExiste(para: string): Promise<boolean | null> {
    // Grupo não é número: a conferência é feita contra a base de contas
    // pessoais do WhatsApp e responderia "não existe" pra todo grupo,
    // barrando um envio perfeitamente válido.
    if (ehGrupo(para)) return true;

    const credenciais = await this.credenciais();
    if (!credenciais) return null;

    const numero = this.destino(para);
    const resposta = await evolution.conferirNumeros(credenciais, [numero]);
    if (!resposta.ok || !Array.isArray(resposta.dados)) {
      this.logger.warn(
        `Não deu pra conferir o número ${numero} no WhatsApp: ${resposta.erro ?? 'resposta inesperada'}.`,
      );
      return null;
    }

    const conferido = resposta.dados[0];
    // Campo ausente também é "não sei": versões diferentes da Evolution
    // respondem formatos diferentes, e assumir `false` num formato que não
    // reconhecemos bloquearia envio pra cliente de verdade.
    return typeof conferido?.exists === 'boolean' ? conferido.exists : null;
  }

  /**
   * As últimas mensagens guardadas no servidor pra esta conversa.
   *
   * `null` é "não deu pra perguntar" (sessão caída, servidor fora) — quem
   * chama segue sem recuperar nada, como antes.
   */
  async mensagensGuardadas(
    para: string,
    limite: number,
    lid?: string | null,
  ): Promise<DadosDaMensagem[] | null> {
    const credenciais = await this.credenciais();
    if (!credenciais) return null;

    const jid = jidDoTelefone(para);
    const resposta = await evolution.buscarMensagens(
      credenciais,
      jid,
      limite,
      lid,
    );
    if (!resposta.ok) {
      this.logger.warn(
        `Não deu pra buscar as mensagens guardadas de ${this.destino(para)}: ${resposta.erro ?? 'sem motivo'}.`,
      );
      return null;
    }
    const lista = (resposta.dados ?? []) as DadosDaMensagem[];
    // Guardada só com o @lid: o telefone conhecido vai no lugar dele, pra
    // quem lê não descartar a mensagem como "sem dono".
    for (const dados of lista) {
      if (lid && dados.key?.remoteJid === lid && !dados.key.remoteJidAlt) {
        dados.key.remoteJidAlt = jid;
      }
    }
    return lista;
  }

  /**
   * O destino do jeito que a Evolution espera.
   *
   * Para pessoa, só os dígitos. Para GRUPO, o JID inteiro — e é por isso
   * que isto existe em vez de um `replace` solto em cada envio: a limpeza
   * de dígitos comeria o `@g.us` e mandaria a mensagem pra um destino
   * individual inexistente. Eram três lugares fazendo a mesma limpeza, e
   * bastava um deles ficar pra trás.
   */
  private destino(para: string): string {
    return ehGrupo(para) ? para.trim() : para.replace(/\D/g, '');
  }

  /**
   * A citada com a chave inteira e o texto dela — ver `citacao` no
   * evolution.client. O texto sai do painel; sem ele (anexo sem legenda),
   * vai um rótulo, que é o que o WhatsApp mostra na tarjinha.
   */
  private async citada(citando?: IdExterno | null): Promise<Citada | null> {
    if (!citando) return null;
    const chave = desempacotarId(citando);
    if (!chave) return { id: citando };

    const original = await this.prisma.db.message
      .findFirst({
        where: { externalId: citando },
        select: { content: true, messageType: true },
      })
      .catch(() => null);

    return {
      id: chave.id,
      remoteJid: chave.remoteJid,
      fromMe: chave.fromMe,
      texto:
        original?.content?.trim() ||
        (original ? (ROTULO_DO_ANEXO[original.messageType] ?? null) : null),
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
      numero: this.destino(para),
      texto,
      citando: await this.citada(citando),
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

  /**
   * O arquivo vai direto, sem etapa de upload.
   *
   * O `handle` devolvido é a CHAVE DA MENSAGEM, e não um id de arquivo:
   * a Evolution não hospeda nada: quando alguém quiser o binário de volta,
   * ela vai pedir ao WhatsApp usando essa chave (ver `baixarMidia`). É
   * exatamente o que o contrato quer dizer com handle opaco.
   *
   * Sem chave devolvida não há handle — o anexo saiu, mas o painel nunca
   * vai conseguir mostrá-lo de novo. Vale registrar em vez de falhar: a
   * mensagem chegou no cliente, que é o que importa.
   */
  async enviarMidia(
    para: string,
    arquivo: ArquivoParaEnvio,
    opcoes: { caption?: string; citando?: IdExterno | null } = {},
  ): Promise<EnvioDeMidia> {
    this.ultimaFalha = null;

    const credenciais = await this.credenciais();
    if (!credenciais) return { externalId: null, handle: null };

    const numero = this.destino(para);
    const base64 = arquivo.buffer.toString('base64');
    const citando = await this.citada(opcoes.citando);

    /*
     * Três rotas, porque são três coisas diferentes no aparelho de quem
     * recebe.
     *
     * Figurinha e áudio gravado têm rota própria, e sem elas o efeito se
     * perde no caminho: a figurinha chega como foto de fundo branco, e o
     * áudio como arquivo de música anexado em vez da bolha de voz. Só o
     * resto — imagem, vídeo, documento — vai pela rota comum de mídia.
     */
    const resposta =
      arquivo.tipo === 'sticker'
        ? await evolution.enviarFigurinha(credenciais, {
            numero,
            base64,
            citando,
          })
        : arquivo.tipo === 'audio' && arquivo.voice
          ? await evolution.enviarAudioDeVoz(credenciais, {
              numero,
              base64,
              citando,
            })
          : await evolution.enviarMidia(credenciais, {
              numero,
              tipo: arquivo.tipo,
              base64,
              mimetype: arquivo.mimetype,
              filename: arquivo.filename,
              legenda: opcoes.caption,
              citando,
            });

    if (!resposta.ok) {
      this.ultimaFalha = resposta.erro ?? 'o envio do anexo foi recusado';
      this.logger.error(
        `Falha ao enviar anexo pela Evolution (tenant ${this.prisma.tenantId}): ${resposta.erro}`,
      );
      return { externalId: null, handle: null };
    }

    const chave = resposta.dados?.key;
    if (!chave?.id || !chave.remoteJid) {
      this.logger.warn(
        'A Evolution aceitou o anexo sem devolver a chave; ele não vai poder ser rebaixado depois.',
      );
      return { externalId: null, handle: null };
    }

    const empacotada = empacotarId({
      remoteJid: chave.remoteJid,
      fromMe: chave.fromMe ?? true,
      id: chave.id,
    });

    return { externalId: empacotada, handle: empacotada };
  }

  /**
   * Pede o binário de volta ao WhatsApp, pela chave da mensagem.
   *
   * É o mesmo gesto do aplicativo do celular ao abrir uma conversa antiga:
   * o arquivo não está guardado em lugar nenhum nosso nem da Evolution —
   * ele é buscado na hora. Por isso o handle aqui é a chave, e por isso
   * uma mensagem apagada no WhatsApp deixa de ter anexo pra sempre.
   */
  async baixarMidia(
    handle: string,
    pista?: unknown,
    /**
     * Avisa POR QUE não veio. `definitiva`: a Evolution respondeu que não
     * tem como entregar (o WhatsApp já apagou o arquivo, a mensagem não
     * existe) — tentar de novo dá no mesmo. Senão foi a rede ou o tempo
     * limite, e vale tentar mais tarde.
     */
    aoFalhar?: (definitiva: boolean) => void,
  ): Promise<MidiaBaixada | null> {
    const credenciais = await this.credenciais();
    if (!credenciais) return null;

    const chave = desempacotarId(handle);
    if (!chave) {
      this.logger.warn(
        `Mídia não buscada: o identificador ${handle} não é uma chave da Evolution.`,
      );
      return null;
    }

    // O bloco de mídia guardado com a mensagem (ver `evolutionMedia`, em
    // evolution-mensagem). Com ele a Evolution baixa direto do WhatsApp;
    // sem ele, ela depende de ter a mensagem no banco dela.
    const midia =
      pista && typeof pista === 'object'
        ? (pista as Record<string, unknown>)
        : null;

    const resposta = await evolution.baixarMidia(credenciais, chave, midia);
    if (!resposta.ok || !resposta.dados?.base64) {
      // Com status, quem respondeu foi a Evolution; sem, nem chegou nela.
      aoFalhar?.(resposta.status !== undefined);
      this.logger.warn(
        `Não deu pra buscar a mídia na Evolution: ${resposta.erro ?? 'resposta sem o arquivo'}` +
          (midia ? '' : ' (a mensagem foi gravada sem o endereço do arquivo)'),
      );
      return null;
    }

    return {
      buffer: Buffer.from(resposta.dados.base64, 'base64'),
      mimeType:
        resposta.dados.mimetype ??
        resposta.dados.message?.mimetype ??
        'application/octet-stream',
    };
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
      this.logger.warn(
        `Reação ignorada: id externo em formato antigo (${mensagem}).`,
      );
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

  async editarMensagem(
    _para: string,
    mensagem: IdExterno,
    texto: string,
  ): Promise<string | null> {
    const credenciais = await this.credenciais();
    if (!credenciais) return 'O WhatsApp não está conectado.';

    const chave = desempacotarId(mensagem);
    if (!chave) return 'Esta mensagem não tem identificação no WhatsApp.';

    // A chave guardada é a que o próprio WhatsApp deu à mensagem — é a
    // que a Evolution procura no banco dela pra achar a original.
    const resposta = await evolution.editarMensagem(credenciais, {
      chave,
      texto,
    });
    if (resposta.ok) return null;
    this.logger.warn(`Não deu pra editar pela Evolution: ${resposta.erro}`);
    return resposta.erro ?? 'O WhatsApp recusou a edição.';
  }

  async apagarParaTodos(
    _para: string,
    mensagem: IdExterno,
  ): Promise<string | null> {
    const credenciais = await this.credenciais();
    if (!credenciais) return 'O WhatsApp não está conectado.';

    const chave = desempacotarId(mensagem);
    if (!chave) return 'Esta mensagem não tem identificação no WhatsApp.';

    const resposta = await evolution.apagarParaTodos(credenciais, chave);
    if (resposta.ok) return null;
    this.logger.warn(
      `Não deu pra apagar para todos pela Evolution: ${resposta.erro}`,
    );
    return resposta.erro ?? 'O WhatsApp recusou apagar a mensagem.';
  }

  async marcarComoLida(mensagem: IdExterno): Promise<void> {
    const credenciais = await this.credenciais();
    if (!credenciais) return;

    const chave = desempacotarId(mensagem);
    if (!chave) return;

    const resposta = await evolution.marcarComoLida(credenciais, chave);
    if (!resposta.ok) {
      this.logger.warn(
        `Não deu pra marcar como lida pela Evolution: ${resposta.erro}`,
      );
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

  /**
   * O nome do grupo, pra a conversa não se chamar `120363...@g.us`.
   *
   * O evento de mensagem traz o ENDEREÇO do grupo, nunca o nome — ele mora
   * na informação do grupo, que é outra chamada. `null` quando não deu:
   * o painel usa o endereço como nome provisório e tenta de novo na
   * próxima mensagem, o que é melhor que segurar o recebimento.
   */
  async nomeDoGrupo(groupJid: string): Promise<string | null> {
    const credenciais = await this.credenciais();
    if (!credenciais) return null;

    const resposta = await evolution.buscarGrupo(credenciais, groupJid);
    const nome = resposta.dados?.subject?.trim();
    if (!resposta.ok || !nome) {
      this.logger.warn(
        `Não deu pra descobrir o nome do grupo ${groupJid}: ${resposta.erro ?? 'sem nome na resposta'}.`,
      );
      return null;
    }

    return nome;
  }

  /**
   * A foto de perfil de um cliente ou grupo.
   *
   * Três respostas diferentes, porque o chamador trata cada uma de um jeito:
   * a URL; `null` quando a pessoa não tem foto (ou a esconde) — o que conta
   * como conferido; e `undefined` quando a pergunta falhou, que é pra
   * tentar de novo na próxima mensagem em vez de gravar "sem foto".
   */
  async fotoDePerfil(numero: string): Promise<string | null | undefined> {
    const credenciais = await this.credenciais();
    if (!credenciais) return undefined;

    const resposta = await evolution.buscarFotoDePerfil(credenciais, numero);
    if (!resposta.ok) {
      this.logger.warn(
        `Não deu pra buscar a foto de perfil de ${numero}: ${resposta.erro ?? 'sem resposta'}.`,
      );
      return undefined;
    }

    const url = resposta.dados?.profilePictureUrl;
    return typeof url === 'string' && url.startsWith('http') ? url : null;
  }
}
