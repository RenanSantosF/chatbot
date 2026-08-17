import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Prisma } from '../../../../../generated/prisma/client';
import { Public } from '../../../../common/auth/public.decorator';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedRequest } from '../../../auth/auth.types';
import { ConversationsService } from '../../../conversations/conversations.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { WhatsappMediaService } from '../../whatsapp-media.service';
import { empacotarId, telefoneDoJid } from './evolution-id';
import {
  chaveDoEvento,
  comoLista,
  reacaoDaMensagem,
  horaDaMensagem,
  traduzirMensagem,
  traduzirStatus,
  type DadosDaMensagem,
  type EventoDaEvolution,
} from './evolution-mensagem';

/** Uma linha do histórico, no formato que `importarHistorico` espera. */
type MensagemImportada = Parameters<
  ConversationsService['importarHistorico']
>[0]['mensagens'][number];

/**
 * Onde a Evolution entrega o que chega no WhatsApp.
 *
 * A autenticação é o segredo no caminho da URL, e não uma assinatura como
 * a da Meta: a Evolution não assina as entregas. É menos do que se
 * gostaria, e por isso o segredo tem 24 bytes aleatórios, é por empresa, e
 * a comparação é em tempo constante — sem isso, o tempo de resposta
 * revelaria o segredo caractere por caractere.
 */
// Sem limite de requisições, mesma razão do webhook da Meta: mensagem
// chega em rajada, e barrar aqui derrubaria o recebimento pra defender de
// um ataque que o segredo já barra.
@SkipThrottle()
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  private readonly logger = new Logger(EvolutionWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeGateway,
    private readonly media: WhatsappMediaService,
  ) {}

  @Public()
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receber(
    @Param('secret') secret: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: EventoDaEvolution,
  ) {
    const config = await this.acharPeloSegredo(secret);
    if (!config) {
      throw new ForbiddenException('Segredo inválido.');
    }

    // O nome da sessão vem em todo evento. Conferir contra o que está
    // gravado pega o caso de um servidor mal configurado apontando duas
    // sessões pra mesma URL — que criaria mensagem de uma empresa dentro
    // do painel de outra.
    if (body.instance && body.instance !== config.instance) {
      this.logger.warn(
        `Evento da sessão ${body.instance} chegou pela URL da sessão ${config.instance}; ignorado.`,
      );
      return { ok: true };
    }

    // Mesmo truque do webhook da Meta: um "usuário" sintético pro resto do
    // caminho (TenantPrismaService) resolver a empresa certa. Quem
    // autenticou esta requisição foi o segredo da URL.
    req.user = {
      userId: 'evolution-webhook',
      tenantId: config.tenantId,
      role: 'OWNER',
      email: 'webhook@evolution',
      name: 'WhatsApp',
    };

    // Ponto E hífen viram sublinhado: os eventos chegam em duas grafias
    // conforme a versão do servidor ("messages.upsert", "MESSAGES_UPSERT"),
    // e o do histórico usa as duas de uma vez — `messaging-history.set`.
    // Trocar só o ponto deixava esse de fora sem nenhum aviso: ele caía no
    // `default` e virava uma linha de log em nível debug.
    const evento = body.event?.toUpperCase().replace(/[.-]/g, '_');
    switch (evento) {
      case 'MESSAGES_UPSERT':
        await this.mensagens(body, config);
        // Mensagem chegando é prova de sessão viva. Conserta sozinho o
        // estado que ficou torto — ver `corrigirEstadoTorto`.
        await this.corrigirEstadoTorto(config);
        break;
      case 'MESSAGES_UPDATE':
        await this.statusDeEntrega(body);
        break;
      case 'CONNECTION_UPDATE':
        await this.conexao(body, config);
        break;
      case 'MESSAGES_SET':
      case 'MESSAGING_HISTORY_SET':
        await this.historico(body, config);
        break;
      case 'QRCODE_UPDATED':
        await this.qrCode(body, config);
        break;
      default:
        this.logger.debug(`Evento ignorado: ${body.event ?? 'sem nome'}`);
    }

    // Sempre 200, como no caminho oficial: a Evolution reenvia quando não
    // recebe, e um lote reenviado é mensagem duplicada no painel.
    return { ok: true };
  }

  private async acharPeloSegredo(secret: string) {
    // Só busca no banco depois de conferir o formato: sem isto, qualquer
    // string vira uma consulta, e o endereço do webhook é público.
    if (!/^[0-9a-f]{48}$/.test(secret)) return null;

    const config = await this.prisma.client.evolutionSettings.findFirst({
      where: { webhookSecret: secret },
    });
    if (!config) return null;

    // A consulta acima já é por igualdade exata, mas a comparação em tempo
    // constante fica de guarda pro dia em que a busca virar algo mais
    // esperto (prefixo, cache) e o tempo passar a contar história.
    const esperado = Buffer.from(config.webhookSecret);
    const recebido = Buffer.from(secret);
    if (esperado.length !== recebido.length) return null;
    return timingSafeEqual(esperado, recebido) ? config : null;
  }

  private async mensagens(
    body: EventoDaEvolution,
    config: { tenantId: string; id: string },
  ) {
    for (const dados of comoLista(body.data)) {
      const chave = chaveDoEvento(dados);
      if (!chave) continue;

      const telefone = telefoneDoJid(chave.remoteJid);
      if (!telefone) {
        // Grupo, lista de transmissão, status. Nenhum deles é atendimento
        // individual, e tratar como se fosse criaria um "cliente" com o id
        // do grupo misturando o que várias pessoas escreveram.
        continue;
      }

      // Reação modifica a mensagem reagida em vez de virar linha nova no
      // histórico — mesmo tratamento do caminho oficial. Sem isto, o
      // cliente reage e o emoji simplesmente some.
      const reacao = reacaoDaMensagem(dados);
      if (reacao) {
        await this.conversations.applyReaction(
          empacotarId(reacao.alvo),
          reacao.emoji,
          // Quem reagiu pelo celular da empresa é a empresa, não o
          // cliente: creditar ao cliente colocaria o emoji do lado errado.
          chave.fromMe ? 'agent' : telefone,
        );
        continue;
      }

      const traduzida = traduzirMensagem(dados);
      if (!traduzida) {
        this.logger.warn(
          `Tipo de mensagem não suportado na sessão ${config.id}: ${Object.keys(dados.message ?? {}).join(', ')}`,
        );
        continue;
      }

      const externalId = empacotarId(chave);

      /*
       * O anexo recebido ganha por onde ser buscado.
       *
       * Na Evolution o binário não fica hospedado com um id, como na Meta:
       * ela pede o arquivo ao WhatsApp usando a CHAVE DA MENSAGEM, que é
       * justamente o id externo. Guardar a chave como handle é o que faz o
       * painel conseguir mostrar a foto — antes o balão só tinha o nome do
       * arquivo e um aviso de indisponível, porque não havia por onde
       * buscar.
       *
       * O campo se chama `mediaId` por herança da Meta, mas o contrato do
       * canal já o trata como handle opaco (ver canal.interface).
       */
      if (traduzida.metadata?.evolutionPendente) {
        traduzida.metadata = {
          ...traduzida.metadata,
          evolutionPendente: undefined,
          mediaId: externalId,
        };

        /*
         * E o binário é guardado AGORA, enquanto ele existe.
         *
         * A Evolution não hospeda arquivo: ela pede ao WhatsApp usando a
         * chave da mensagem, e consegue enquanto a mensagem ainda estiver
         * no alcance dela. Depois disso o anexo simplesmente não volta
         * mais — foi o que apareceu no painel como "não deu pra buscar
         * este anexo", com a foto virando um cartão de arquivo genérico.
         *
         * Sem `await`: a Evolution reenvia a entrega se demorarmos a
         * responder, e baixar um vídeo no meio do caminho estouraria esse
         * orçamento. Falhar aqui não pode derrubar o recebimento da
         * mensagem — no pior caso o anexo continua sendo buscado sob
         * demanda, como antes.
         */
        void this.media.arquivar(externalId, traduzida.metadata.fileName as string | undefined);
      }

      // Mensagem escrita pelo celular da própria empresa. Sem tratar isto,
      // o painel mostraria a pergunta e nunca a resposta — e a IA
      // responderia por cima de quem já respondeu. É o mesmo problema dos
      // ecos de coexistência no caminho oficial, e aqui ele é a REGRA:
      // conexão por aparelho vinculado significa que o celular continua na
      // mão de alguém.
      if (chave.fromMe) {
        await this.conversations.recordOutboundEcho({
          customerPhone: telefone,
          content: traduzida.content,
          messageType: traduzida.messageType,
          metadata: traduzida.metadata as Prisma.InputJsonValue | undefined,
          externalId,
        });
        continue;
      }

      await this.conversations.receiveInbound({
        customerPhone: telefone,
        customerName: dados.pushName ?? telefone,
        content: traduzida.content,
        messageType: traduzida.messageType,
        metadata: traduzida.metadata as Prisma.InputJsonValue | undefined,
        channel: 'WHATSAPP',
        externalId,
        replyToExternalId: traduzida.citando
          ? empacotarId({
              remoteJid: chave.remoteJid,
              // A citação aponta pra uma mensagem NOSSA na esmagadora
              // maioria das vezes: o cliente está respondendo o que a
              // empresa escreveu.
              fromMe: true,
              id: traduzida.citando,
            })
          : undefined,
        createdAt: horaDaMensagem(dados),
      });
    }
  }

  private async statusDeEntrega(body: EventoDaEvolution) {
    for (const dados of comoLista(body.data)) {
      // A chave chega achatada neste evento — ver `chaveDoEvento`. Ler
      // `data.key` aqui faria todo tique de entrega ser descartado em
      // silêncio, com o envio funcionando normalmente.
      const chave = chaveDoEvento(dados);
      if (!chave) continue;

      const estado = traduzirStatus(dados.status);
      if (!estado) continue;

      await this.conversations.applyDeliveryStatus(empacotarId(chave), estado);
    }
  }

  /**
   * As conversas que já estavam no aparelho.
   *
   * O pareamento não traz só o telefone: o aparelho despeja o que já
   * existia nele, em lotes, por este evento. Sem tratá-lo, o painel
   * nascia vazio e — pior — tudo que a empresa conversasse pelo celular
   * enquanto o painel estivesse desconectado sumia pra sempre, porque na
   * volta ninguém ia buscar.
   *
   * A importação é agrupada POR CONTATO antes de gravar: os lotes vêm
   * misturados, e chamar `importarHistorico` uma vez por mensagem faria
   * uma consulta de cliente e uma de conversa para cada linha de um lote
   * que costuma ter milhares.
   */
  private async historico(
    body: EventoDaEvolution,
    config: { id: string; tenantId: string; instance: string },
  ) {
    const dados = body.data as
      | { messages?: DadosDaMensagem[]; isLatest?: boolean; progress?: number }
      | DadosDaMensagem[]
      | undefined;

    /*
     * O lote vem de dois jeitos, e o andamento vem de fora.
     *
     * No webhook de verdade, `data` É a lista de mensagens, e o "é o
     * último?" sobe pra raiz do evento. A forma com `data.messages` é a
     * de dentro da Evolution. Aceitar as duas custa uma linha; aceitar só
     * a de dentro fazia a importação nunca começar nem terminar — sem
     * erro nenhum, porque o formato simplesmente não batia.
     */
    const lote = Array.isArray(dados)
      ? dados
      : Array.isArray(dados?.messages)
        ? dados.messages
        : [];
    // O lote final costuma vir vazio, só pra avisar que acabou.
    const ultimo =
      body.isLatest === true || (!Array.isArray(dados) && dados?.isLatest === true);

    const porContato = new Map<
      string,
      { nome?: string; mensagens: MensagemImportada[] }
    >();

    for (const mensagem of lote) {
      const chave = chaveDoEvento(mensagem);
      if (!chave) continue;

      const telefone = telefoneDoJid(chave.remoteJid);
      // Grupo, transmissão e status ficam de fora, como no caminho ao
      // vivo: nenhum deles é atendimento individual.
      if (!telefone) continue;

      const traduzida = traduzirMensagem(mensagem);
      if (!traduzida) continue;

      /*
       * Sem hora, a mensagem não entra.
       *
       * No caminho ao vivo, hora ausente cai pra "agora" e não faz mal —
       * a mensagem chegou agora mesmo. Aqui faria: uma conversa de três
       * meses atrás entraria carimbada de hoje, subiria pro topo do Inbox
       * e apareceria como atendimento novo. Perder uma linha sem data é
       * mais barato que embaralhar a linha do tempo inteira.
       */
      const createdAt = horaDaMensagem(mensagem);
      if (!createdAt) continue;

      const externalId = empacotarId(chave);
      const metadata = traduzida.metadata
        ? {
            ...traduzida.metadata,
            // O anexo antigo NÃO é arquivado aqui: seriam milhares de
            // downloads numa importação, e o WhatsApp já não devolve o
            // binário de mensagem velha na maior parte das vezes. O
            // handle fica gravado e a busca acontece sob demanda, se
            // alguém abrir aquele balão.
            evolutionPendente: undefined,
            ...(traduzida.metadata.evolutionPendente
              ? { mediaId: externalId }
              : {}),
          }
        : undefined;

      const registro = porContato.get(telefone) ?? {
        nome: mensagem.pushName ?? undefined,
        mensagens: [],
      };
      registro.mensagens.push({
        daEmpresa: Boolean(chave.fromMe),
        content: traduzida.content,
        messageType: traduzida.messageType,
        metadata: metadata as Prisma.InputJsonValue | undefined,
        externalId,
        createdAt,
      });
      porContato.set(telefone, registro);
    }

    let importadas = 0;
    for (const [telefone, registro] of porContato) {
      try {
        importadas += await this.conversations.importarHistorico({
          customerPhone: telefone,
          customerName: registro.nome ?? telefone,
          mensagens: registro.mensagens,
        });
      } catch (erro) {
        // Um contato problemático não pode levar o lote inteiro junto: o
        // que já foi gravado continua valendo, e o resto segue.
        this.logger.warn(
          `Não deu pra importar o histórico de ${telefone}: ${erro instanceof Error ? erro.message : erro}`,
        );
      }
    }

    const settings = await this.prisma.client.evolutionSettings.update({
      where: { id: config.id },
      data: {
        historicoMensagens: { increment: importadas },
        ...(ultimo
          ? {
              historicoEstado: 'CONCLUIDO' as const,
              historicoConcluidoEm: new Date(),
            }
          : { historicoEstado: 'IMPORTANDO' as const }),
      },
      select: { historicoMensagens: true, historicoEstado: true },
    });

    this.realtime.emitToTenant(config.tenantId, 'canal.historico', {
      estado: settings.historicoEstado,
      mensagens: settings.historicoMensagens,
    });

    this.logger.log(
      `Histórico da sessão ${config.instance}: ${importadas} mensagens de ` +
        `${porContato.size} contatos${ultimo ? ' (último lote)' : ''}.`,
    );
  }

  /**
   * A sessão está entregando mensagem e o painel diz que ela caiu.
   *
   * Existe porque o estado errado GRAVADO não se conserta sozinho: ele só
   * mudaria no próximo `open`, e num aparelho já pareado esse evento pode
   * demorar horas — ou não vir nunca, se a sessão nunca mais oscilar. A
   * empresa fica com o compositor travado e o aviso de "reconecte" na
   * tela enquanto o WhatsApp funciona perfeitamente do outro lado.
   *
   * Mensagem entregue é a prova mais forte que existe de que a sessão
   * está de pé — mais forte que qualquer estado que tenhamos gravado
   * antes. Então ela ganha da nossa anotação.
   */
  private async corrigirEstadoTorto(config: {
    id: string;
    tenantId: string;
    estado: string;
    instance: string;
  }) {
    if (config.estado === 'CONECTADO') return;

    await this.prisma.client.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado: 'CONECTADO',
        lastSeenAt: new Date(),
        qrCode: null,
        pairingCode: null,
        lastError: null,
      },
    });

    this.realtime.emitToTenant(config.tenantId, 'canal.estado', {
      estado: 'CONECTADO',
      lastError: null,
    });

    this.logger.log(
      `Sessão ${config.instance} estava marcada como ${config.estado} mas ` +
        'entregou mensagem; estado corrigido pra CONECTADO.',
    );
  }

  private async conexao(
    body: EventoDaEvolution,
    config: {
      id: string;
      tenantId: string;
      instance: string;
      /**
       * Quando a sessão esteve de pé pela última vez.
       *
       * É o que separa "nunca pareou" de "já pareou e está reconectando".
       * Escolhido em vez de `connectedPhone` porque aquele campo existe no
       * schema mas nunca chega a ser gravado — só lido e zerado —, então
       * apoiar a decisão nele seria apoiá-la em algo sempre nulo.
       */
      lastSeenAt: Date | null;
    },
  ) {
    const dados = body.data as { state?: string; statusReason?: number } | undefined;
    const bruto = dados?.state;

    /*
     * `connecting` só quer dizer "aguardando parear" ANTES do primeiro
     * pareamento.
     *
     * A Evolution manda `connecting` toda vez que o socket sobe — e ele
     * sobe de novo depois de conectado, em reconexão, em reinício do
     * servidor, e logo em seguida ao `open` do pareamento por código.
     * Traduzir isso pra AGUARDANDO_QRCODE rebaixava uma sessão que estava
     * VIVA: o painel passava a exibir "aguardando a leitura do QR code",
     * travava o compositor e mandava reconectar uma conexão que nunca
     * tinha caído.
     *
     * Quem já pareou tem telefone gravado. Nesse caso `connecting` é
     * transitório e o estado anterior continua valendo — se a sessão
     * tiver caído mesmo, o `close` chega e diz isso com todas as letras.
     */
    const jaPareado = Boolean(config.lastSeenAt);

    /*
     * 515 não é queda: é "reinicie o socket".
     *
     * O protocolo EXIGE que a conexão seja derrubada e refeita logo depois
     * de um pareamento bem-sucedido, e o WhatsApp comunica isso com um
     * `close` de motivo 515. Ele aparece nos dois caminhos, mas no
     * pareamento por CÓDIGO é a regra — e como o `open` seguinte pode
     * chegar antes, depois ou se perder, gravar "desconectado" aqui deixa
     * a faixa vermelha de "as mensagens não vão chegar" numa sessão que
     * acabou de conectar e está funcionando.
     *
     * Só o 401 (desvinculado no aparelho) é queda de verdade. O resto o
     * servidor reconecta sozinho — mas continua sendo avisado, porque uma
     * sessão realmente caída precisa aparecer.
     */
    const reinicioDoProtocolo = dados?.statusReason === 515;

    const estado =
      bruto === 'open'
        ? ('CONECTADO' as const)
        : bruto === 'connecting'
          ? jaPareado
            ? null
            : ('AGUARDANDO_QRCODE' as const)
          : reinicioDoProtocolo
            ? null
            : ('DESCONECTADO' as const);

    if (estado === null) {
      this.logger.log(
        `Sessão ${config.instance}: ${
          reinicioDoProtocolo ? 'reinício exigido pelo protocolo' : 'reconectando (já pareada)'
        } — estado mantido.`,
      );
      return;
    }

    // O código de motivo é o que separa "o celular ficou sem internet" de
    // "o WhatsApp desvinculou o aparelho" — e só o segundo exige ler o QR
    // code de novo.
    const lastError =
      estado === 'DESCONECTADO'
        ? dados?.statusReason === 401
          ? 'o aparelho foi desvinculado no WhatsApp; leia o QR code de novo'
          : 'a sessão caiu no servidor de mensagens'
        : null;

    await this.prisma.client.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado,
        ...(estado === 'CONECTADO'
          ? {
              lastSeenAt: new Date(),
              qrCode: null,
              pairingCode: null,
              lastError: null,
              /*
               * Parear abre uma janela de importação.
               *
               * A marca é feita aqui e não quando o primeiro lote chega
               * porque é aqui que dá pra saber que ela COMEÇOU. Se o
               * aparelho não mandar nada, `historicoIniciadoEm` é o que
               * permite desistir de esperar — ver `sincronizando()`.
               */
              historicoEstado: 'IMPORTANDO' as const,
              historicoMensagens: 0,
              historicoIniciadoEm: new Date(),
              historicoConcluidoEm: null,
            }
          : {}),
        ...(estado === 'DESCONECTADO' ? { lastError } : {}),
      },
    });

    /*
     * A queda aparece na tela na hora, sem ninguém recarregar nada.
     *
     * Antes isto só ia pro banco. Quem estivesse no painel continuava
     * atendendo normalmente — digitando resposta, apertando enviar — e as
     * mensagens sumiam no caminho, porque do outro lado não havia mais
     * sessão. A tela só contava a verdade na próxima vez que alguém
     * abrisse as configurações.
     *
     * Desconectar é o evento mais urgente que este webhook entrega: é o
     * único que faz TODO o resto do produto parar de funcionar.
     */
    this.realtime.emitToTenant(config.tenantId, 'canal.estado', {
      estado,
      lastError,
    });

    this.logger.log(`Sessão ${config.instance}: ${estado}.`);
  }

  private async qrCode(
    body: EventoDaEvolution,
    config: { id: string; tenantId: string },
  ) {
    const dados = body.data as
      | {
          qrcode?: { base64?: string; pairingCode?: string };
          base64?: string;
          pairingCode?: string;
        }
      | undefined;
    const qrCode = dados?.qrcode?.base64 ?? dados?.base64 ?? null;
    // O mesmo evento serve aos dois jeitos de parear: com número, a
    // Evolution renova o CÓDIGO em vez da imagem, e ele expira igual.
    const pairingCode = dados?.qrcode?.pairingCode ?? dados?.pairingCode ?? null;
    if (!qrCode && !pairingCode) return;

    await this.prisma.client.evolutionSettings.update({
      where: { id: config.id },
      data: {
        ...(qrCode ? { qrCode } : {}),
        ...(pairingCode ? { pairingCode } : {}),
        estado: 'AGUARDANDO_QRCODE',
      },
    });

    /*
     * O QR code chega por aqui ANTES de a tela conseguir pedi-lo.
     *
     * Criar a sessão leva uns bons segundos no servidor de mensagens
     * (ele sobe um socket do WhatsApp inteiro), e a tela ficava esperando
     * a resposta daquela chamada pra só então mostrar a imagem. Mas a
     * Evolution avisa o QR code por webhook assim que ele existe — que é
     * bem antes de ela terminar de responder à criação.
     *
     * Empurrando por aqui, a imagem aparece no instante em que nasce. O
     * mesmo vale pra cada renovação: o código expira em cerca de um
     * minuto, e a troca passa a ser automática em vez de um botão.
     */
    this.realtime.emitToTenant(config.tenantId, 'canal.estado', {
      estado: 'AGUARDANDO_QRCODE' as const,
      ...(qrCode ? { qrCode } : {}),
      ...(pairingCode ? { pairingCode } : {}),
    });
  }
}
