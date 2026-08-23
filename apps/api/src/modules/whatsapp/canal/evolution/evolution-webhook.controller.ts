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
import {
  CustomersService,
  type ContatoDoAparelho,
} from '../../../customers/customers.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { EvolutionCanal } from './evolution.canal';
import { WhatsappMediaService } from '../../whatsapp-media.service';
import { empacotarId, identidadeDoDestino, telefoneDoJid } from './evolution-id';
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
    private readonly customers: CustomersService,
    private readonly evolution: EvolutionCanal,
  ) {}

  /**
   * A agenda do aparelho virando o nome que aparece no painel.
   *
   * Sem isto, o nome de um cliente era o apelido que ele mesmo escolheu
   * no WhatsApp — quando escolheu. Quem não pôs nada virava um telefone
   * na tela, e não havia como achar ninguém pesquisando por nome.
   *
   * A ordem de preferência importa: o nome SALVO na agenda ganha do
   * apelido público, porque é assim que a empresa chama aquela pessoa no
   * dia a dia — e é por ele que alguém vai procurar.
   *
   * Nada aqui lança: uma agenda que não veio é um painel com menos nomes,
   * não um webhook quebrado.
   */
  private async salvarContatos(contatos?: ContatoDoAparelho[]) {
    if (!Array.isArray(contatos) || contatos.length === 0) return;

    const { recebidos, salvos } = await this.customers.importarAgenda(contatos);

    // Os dois números, e não só o que entrou: "0 de 312" é uma pista —
    // chegou agenda e nada serviu. Nenhuma linha no log, que era o que
    // acontecia antes, não distingue isso de "a agenda nunca chegou".
    this.logger.log(
      `Agenda do aparelho: ${salvos} de ${recebidos} contatos salvos.`,
    );
  }

  /**
   * O nome do grupo, perguntado o mínimo de vezes possível.
   *
   * O evento de mensagem traz o ENDEREÇO do grupo (`120363...@g.us`),
   * nunca o nome — ele mora numa chamada à parte. Perguntar em toda
   * mensagem custaria uma ida ao servidor por mensagem num grupo
   * movimentado, que é justamente onde mais chega mensagem.
   *
   * Por isso três camadas, da mais barata pra mais cara: o mapa desta
   * requisição (um lote de webhook costuma trazer várias mensagens do
   * mesmo grupo), o nome que já está gravado, e só então a pergunta ao
   * servidor.
   *
   * Sem nome, devolve o próprio endereço. Feio, mas é provisório: como o
   * endereço não passa na conferência de "tem nome de verdade", a próxima
   * mensagem tenta de novo — e segurar o recebimento por causa de um nome
   * seria trocar mensagem perdida por estética.
   */
  private async nomeDoGrupo(tenantId: string, groupJid: string): Promise<string> {
    const memorizado = this.nomesDeGrupo.get(groupJid);
    if (memorizado) return memorizado;

    const existente = await this.prisma.client.customer.findFirst({
      where: { tenantId, phone: groupJid },
      select: { id: true, name: true },
    });
    if (existente && existente.name !== groupJid) {
      this.nomesDeGrupo.set(groupJid, existente.name);
      return existente.name;
    }

    const nome = await this.evolution.nomeDoGrupo(groupJid);
    if (!nome) return groupJid;

    this.nomesDeGrupo.set(groupJid, nome);
    // O grupo já existia com o endereço no lugar do nome: agora que
    // sabemos, corrige. Sem isto, quem foi criado numa hora em que o
    // servidor não respondeu ficaria com o endereço pra sempre.
    if (existente) {
      await this.prisma.client.customer
        .update({ where: { id: existente.id }, data: { name: nome } })
        .catch(() => undefined);
    }
    return nome;
  }

  /**
   * Os nomes de grupo já resolvidos NESTA requisição.
   *
   * O controlador tem escopo de requisição (ele injeta serviços que têm),
   * então este mapa nasce e morre com o lote de webhook — que é
   * exatamente a janela em que a repetição acontece.
   */
  private readonly nomesDeGrupo = new Map<string, string>();

  @Public()
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receber(
    @Param('secret') secret: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: EventoDaEvolution,
  ) {
    const config = await this.acharSessao(secret, body.instance);
    if (!config) {
      throw new ForbiddenException('Segredo inválido.');
    }

    /*
     * O evento é de uma sessão que esta empresa não tem mais.
     *
     * Acontece o tempo todo depois de um pareamento novo: o nome da
     * sessão é sorteado de novo (ver `conectar`), e a sessão velha
     * continua viva no servidor de mensagens mandando evento pelo mesmo
     * endereço. Ela não é de ninguém — entregar o que ela manda seria
     * gravar, na conversa de hoje, o que chegou num pareamento
     * abandonado.
     *
     * Em nível de depuração porque não é problema nosso e acontece às
     * dezenas: em WARN, ele afogava o log justamente na hora em que
     * alguém estaria lendo pra entender por que nada chega.
     */
    if (body.instance && body.instance !== config.instance) {
      this.logger.debug(
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
      case 'MESSAGES_DELETE':
        await this.apagadas(body);
        break;
      case 'MESSAGES_UPDATE':
        await this.statusDeEntrega(body);
        break;
      case 'CONNECTION_UPDATE':
        await this.conexao(body, config);
        break;
      // A agenda do aparelho, na conexão e a cada vez que ela muda.
      case 'CONTACTS_SET':
      case 'CONTACTS_UPSERT':
      case 'CONTACTS_UPDATE':
        await this.salvarContatos(body.data as ContatoDoAparelho[] | undefined);
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

  /**
   * De qual empresa é esta entrega.
   *
   * Duas perguntas, nesta ordem, e a ordem é o conserto: PRIMEIRO quem é
   * o dono da sessão que o evento diz ser, depois quem é o dono do
   * segredo.
   *
   * Buscar só pelo segredo dava certo enquanto cada empresa tinha o seu.
   * Não tinham: um defeito de isolamento (ver `TENANT_SCOPED_MODELS`)
   * fez empresas diferentes compartilharem a mesma linha de configuração,
   * e com ela o mesmo segredo. A busca então devolvia uma delas — a que o
   * banco quisesse — e todo evento das outras era descartado com a
   * mensagem de "sessão diferente". Do lado de fora: conecta, diz
   * conectado, e nenhuma conversa aparece.
   *
   * O segredo continua sendo quem autentica. Achar a linha pelo nome da
   * sessão não afrouxa nada: se o segredo daquela linha não for o que
   * veio na URL, a entrega é recusada do mesmo jeito — e é o que impede
   * que quem tenha o segredo de uma empresa entregue evento em nome de
   * outra.
   */
  private async acharSessao(secret: string, instance?: string) {
    // Só busca no banco depois de conferir o formato: sem isto, qualquer
    // string vira uma consulta, e o endereço do webhook é público.
    if (!/^[0-9a-f]{48}$/.test(secret)) return null;

    const config =
      (instance
        ? await this.prisma.client.evolutionSettings.findFirst({
            where: { instance },
          })
        : null) ??
      (await this.prisma.client.evolutionSettings.findFirst({
        where: { webhookSecret: secret },
      }));
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

      /*
       * Pessoa ou grupo — os dois entram. O resto, não.
       *
       * Lista de transmissão e status não são conversa: ninguém responde a
       * eles pelo painel, e tratá-los como atendimento encheria a caixa de
       * linhas que nunca vão ser lidas.
       *
       * No grupo, o `identificador` é o JID inteiro, e é ele que fica
       * gravado no cliente — grupo não tem telefone (ver
       * `identidadeDoDestino`).
       */
      const destino = identidadeDoDestino(chave.remoteJid);
      if (!destino) continue;

      const telefone = destino.identificador;

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

      /*
       * O nome do grupo não vem na mensagem — só o endereço dele.
       *
       * Por isso ele é perguntado à parte, e só quando o grupo ainda não
       * tem nome gravado. Perguntar em toda mensagem seria uma chamada
       * extra por mensagem num grupo movimentado; sem perguntar nunca, a
       * conversa se chamaria `120363...@g.us` pra sempre.
       */
      const nome = destino.grupo
        ? await this.nomeDoGrupo(config.tenantId, chave.remoteJid)
        : (dados.pushName ?? telefone);

      await this.conversations.receiveInbound({
        customerPhone: telefone,
        customerName: nome,
        grupo: destino.grupo,
        // Em grupo, quem escreveu é o participante — o `pushName` do
        // evento é dele, e não do grupo.
        participante: destino.grupo ? dados.pushName : undefined,
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

  /** Apagou "para todos" no celular: o painel para de mostrar também. */
  private async apagadas(body: EventoDaEvolution) {
    for (const dados of comoLista(body.data)) {
      const chave = chaveDoEvento(dados);
      if (!chave) continue;

      await this.conversations.aplicarApagadaExterna(empacotarId(chave));
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
    config: {
      id: string;
      tenantId: string;
      instance: string;
      historicoProgresso?: number;
      /** Se já estávamos importando — ver a janela de paciência abaixo. */
      historicoEstado?: 'NUNCA' | 'IMPORTANDO' | 'CONCLUIDO';
    },
  ) {
    const dados = body.data as
      | {
          messages?: DadosDaMensagem[];
          contacts?: ContatoDoAparelho[];
          isLatest?: boolean;
          progress?: number;
        }
      | DadosDaMensagem[]
      | undefined;

    /*
     * A agenda vem no MESMO lote das mensagens.
     *
     * Descartá-la era jogar fora, de graça, a única fonte do nome de
     * verdade das pessoas: o que sobra é o apelido que cada um escolheu
     * pra si, e ele nem sempre existe.
     */
    if (!Array.isArray(dados)) {
      await this.salvarContatos(dados?.contacts);
    }

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

    // O percentual vem na raiz do evento, ao lado do `isLatest`.
    const bruto = body.progresso ?? body.progress;
    const progresso =
      typeof bruto === 'number' && Number.isFinite(bruto)
        ? Math.min(100, Math.max(0, Math.round(bruto)))
        : null;

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

      const registro = porContato.get(telefone) ?? { nome: undefined, mensagens: [] };
      /*
       * O nome sai só das mensagens do CLIENTE.
       *
       * Em toda mensagem vem o nome de exibição de quem a escreveu — e
       * nas que a empresa mandou esse nome é o dela, que o WhatsApp
       * costuma entregar como "Você". Pegar dali batizava o cliente de
       * "Você" no painel inteiro, e era o que mais aparecia: numa
       * conversa que a empresa começou, a primeira mensagem do lote é
       * dela.
       */
      if (!chave.fromMe && !registro.nome && mensagem.pushName) {
        registro.nome = mensagem.pushName;
      }
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
        // O percentual NÃO anda sozinho pra trás: os lotes chegam fora de
        // ordem (o de 100% já veio antes do de 95%), e obedecer a ordem de
        // chegada faria a barra recuar na cara de quem está olhando.
        ...(progresso !== null && progresso > (config.historicoProgresso ?? 0)
          ? { historicoProgresso: progresso }
          : {}),
        ...(ultimo
          ? {
              historicoEstado: 'CONCLUIDO' as const,
              historicoConcluidoEm: new Date(),
              // Terminou é cem, mesmo que o último lote não diga.
              historicoProgresso: 100,
            }
          : {
              historicoEstado: 'IMPORTANDO' as const,
              /*
               * Chegou lote sem a janela estar aberta: abre agora.
               *
               * A janela normalmente nasce no pareamento (ver `conexao`),
               * que é onde dá pra saber que ela começou. Mas o aparelho
               * pode mandar histórico fora desse momento, e aí o
               * `historicoIniciadoEm` guardado é de horas atrás — a
               * paciência de dez minutos já venceu, e o painel diria
               * "importação concluída" com os lotes entrando na frente de
               * quem está olhando.
               */
              ...(config.historicoEstado === 'IMPORTANDO'
                ? {}
                : { historicoIniciadoEm: new Date(), historicoConcluidoEm: null }),
            }),
      },
      select: {
        historicoMensagens: true,
        historicoEstado: true,
        historicoProgresso: true,
      },
    });

    this.realtime.emitToTenant(config.tenantId, 'canal.historico', {
      estado: settings.historicoEstado,
      mensagens: settings.historicoMensagens,
      progresso: settings.historicoProgresso,
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
      /** Onde a sessão estava antes deste evento — ver `pareamentoNovo`. */
      estado: string;
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

    // Quem estava esperando leitura acabou de parear; quem nunca esteve de
    // pé, idem. O resto é o socket voltando. Lido ANTES do update, que é o
    // que apaga o estado anterior.
    const pareamentoNovo =
      config.estado === 'AGUARDANDO_QRCODE' || !config.lastSeenAt;

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
               * Parear abre uma janela de importação — PAREAR, e não
               * qualquer `open`.
               *
               * A marca é feita aqui e não quando o primeiro lote chega
               * porque é aqui que dá pra saber que ela COMEÇOU. Se o
               * aparelho não mandar nada, `historicoIniciadoEm` é o que
               * permite desistir de esperar — ver `sincronizando()`.
               *
               * Mas `open` chega toda vez que o socket sobe: depois de uma
               * oscilação de rede, depois de um reinício do servidor de
               * mensagens, várias vezes por dia. Reabrindo a janela em
               * todos eles, o painel voltava a dizer "trazendo as
               * conversas" — com o contador zerado — numa sessão que já
               * tinha trazido tudo, e ficava assim os dez minutos da
               * paciência, sem nenhum lote pra chegar: o aparelho só
               * despeja o histórico num pareamento NOVO.
               *
               * Pareamento novo é o que vinha de uma sessão esperando
               * leitura, ou de uma que nunca esteve de pé. Reconexão é
               * todo o resto — e se mesmo assim vier lote, `historico()`
               * abre a janela ao gravá-lo, que é quando ela é verdade.
               */
              ...(pareamentoNovo
                ? {
                    historicoEstado: 'IMPORTANDO' as const,
                    historicoMensagens: 0,
                    historicoProgresso: 0,
                    historicoIniciadoEm: new Date(),
                    historicoConcluidoEm: null,
                  }
                : {}),
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
