import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * O aviso que chega com o painel FECHADO.
 *
 * A notificação que já existia era criada pela própria página
 * (`new Notification()`, em realtime-provider) e por isso morria junto com
 * a aba: atendente que fechasse o navegador não era avisado de nada. Numa
 * ferramenta de atendimento isso não é um detalhe — mensagem de cliente
 * que não avisa ninguém é cliente esperando.
 *
 * Aqui o caminho é outro: o navegador se inscreve num serviço de push
 * (Google, Mozilla, Apple, conforme o navegador), guarda essa inscrição no
 * nosso banco, e o SERVIDOR empurra o aviso — com ou sem o app aberto.
 *
 * NADA AQUI LANÇA PRA FORA. Este serviço é chamado no caminho de receber
 * mensagem do cliente, que é o mais crítico do sistema: falha de push não
 * pode derrubar a gravação de uma mensagem nem atrasar a resposta do
 * webhook.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  /**
   * Sem VAPID válida o recurso fica desligado, e isso é proposital.
   *
   * As chaves são o que prova ao serviço de push que o envio veio de quem
   * a pessoa autorizou. Sem elas não há como enviar — e o resto do sistema
   * tem que continuar funcionando igual, como já acontece com o
   * armazenamento de anexos e com o ffmpeg.
   */
  private ligado = false;

  constructor(private readonly prisma: PrismaService) {
    this.ligado = this.configurar();
  }

  /**
   * Liga o push, e NUNCA derruba a subida da API se não conseguir.
   *
   * Este `try` existe por um defeito real, e ele custou a API no ar: o
   * `setVapidDetails` LANÇA quando o valor não presta — "Vapid subject is
   * not a valid URL" pra um e-mail sem `mailto:`, por exemplo. Lançar
   * dentro do construtor de um provider faz o Nest abortar a inicialização
   * inteira, então uma variável de ambiente mal digitada não deixava mais
   * nenhuma mensagem entrar no sistema.
   *
   * A promessa era "sem VAPID o resto funciona igual". Ela só valia pro
   * caso de AUSÊNCIA; o de valor inválido matava tudo. Agora vale pros
   * dois: qualquer problema aqui desliga só o aviso, com o motivo escrito
   * no log.
   */
  private configurar(): boolean {
    const publica = process.env.VAPID_PUBLIC_KEY?.trim();
    const privada = process.env.VAPID_PRIVATE_KEY?.trim();

    if (!publica || !privada) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes: o aviso com o app fechado fica desligado. ' +
          'Gere o par com `npx web-push generate-vapid-keys` e configure nas variáveis de ambiente.',
      );
      return false;
    }

    try {
      webpush.setVapidDetails(assunto(), publica, privada);
      return true;
    } catch (erro) {
      this.logger.error(
        `VAPID inválida: ${erro instanceof Error ? erro.message : String(erro)}. ` +
          'O aviso com o app fechado fica desligado; o resto do sistema segue normal.',
      );
      return false;
    }
  }

  /** A chave pública, pra o navegador poder se inscrever. */
  chavePublica(): string | null {
    return this.ligado ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
  }

  /**
   * Guarda (ou atualiza) a inscrição deste aparelho.
   *
   * Upsert pelo `endpoint` porque é ele que identifica o aparelho: o mesmo
   * navegador reinscrevendo devolve o mesmo endpoint, e sem o upsert cada
   * abertura do painel criaria uma linha nova — e a pessoa receberia o
   * mesmo aviso cinco vezes.
   */
  async inscrever(entrada: {
    tenantId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }) {
    const { tenantId, userId, endpoint, p256dh, auth, userAgent } = entrada;
    await this.prisma.client.pushSubscription.upsert({
      where: { endpoint },
      // O tenant e o usuário entram no update também: um computador
      // compartilhado troca de atendente, e a inscrição tem que seguir
      // quem está logado agora — senão o aviso vai pro dono anterior.
      update: { tenantId, userId, p256dh, auth, userAgent },
      create: { tenantId, userId, endpoint, p256dh, auth, userAgent },
    });
  }

  /** Tira este aparelho da lista. Não falha se ele já não estava. */
  async desinscrever(endpoint: string) {
    await this.prisma.client.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /**
   * Avisa a equipe da empresa sobre uma mensagem que chegou.
   *
   * Vai pra TODOS os inscritos da empresa, que é o mesmo recorte da
   * notificação antiga — quem estiver com a conversa aberta não é
   * incomodado porque o próprio service worker cala quando há janela em
   * primeiro plano (ver public/sw.js). Decidir aqui quem "merece" o aviso
   * exigiria saber o que cada aparelho está olhando, coisa que o servidor
   * não sabe.
   */
  async avisarEquipe(
    tenantId: string,
    aviso: { titulo: string; corpo: string; conversationId: string },
  ): Promise<void> {
    if (!this.ligado) return;

    const inscricoes = await this.prisma.client.pushSubscription.findMany({
      where: { tenantId },
    });
    if (inscricoes.length === 0) return;

    const carga = JSON.stringify({
      titulo: aviso.titulo,
      corpo: aviso.corpo,
      conversationId: aviso.conversationId,
    });

    await Promise.all(
      inscricoes.map(async (inscricao) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: inscricao.endpoint,
              keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
            },
            carga,
            { TTL: TEMPO_DE_VIDA_S },
          );
        } catch (erro) {
          await this.tratarFalha(inscricao.endpoint, erro);
        }
      }),
    );
  }

  /**
   * Inscrição morta é apagada; o resto só vira aviso no log.
   *
   * 404 e 410 são a forma do serviço de push dizer "este aparelho não
   * existe mais" — desinstalaram o app, limparam os dados do site, o
   * navegador rodou a chave. Guardar essas linhas faria a lista crescer
   * pra sempre e cada aviso pagar por um envio que nunca chega.
   */
  private async tratarFalha(endpoint: string, erro: unknown): Promise<void> {
    const status = (erro as { statusCode?: number })?.statusCode;

    if (status === 404 || status === 410) {
      await this.prisma.client.pushSubscription
        .deleteMany({ where: { endpoint } })
        .catch(() => undefined);
      return;
    }

    this.logger.warn(
      `Não deu pra avisar um aparelho (${status ?? 'sem status'}): ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }
}

/**
 * Quanto tempo o serviço de push guarda o aviso pra um aparelho offline.
 *
 * Quatro horas: mensagem de atendimento envelhece: avisar às 23h sobre
 * algo que chegou às 9h não ajuda ninguém e ainda assusta. Zero seria o
 * outro extremo — o celular que estava sem sinal por dois minutos perderia
 * o aviso pra sempre.
 */
const TEMPO_DE_VIDA_S = 4 * 60 * 60;

/**
 * O contato do responsável pelo serviço, no formato que a norma exige.
 *
 * A norma pede uma URL (`mailto:` ou `https:`), e a variável quase sempre
 * é preenchida com o e-mail puro — foi o que derrubou a API na primeira
 * configuração real. Um e-mail sem esquema tem UMA leitura possível, então
 * completar é melhor que recusar: o `mailto:` entra sozinho e fica
 * registrado no log, pra quem configurou entender o que aconteceu.
 *
 * O que não for e-mail nem URL passa direto pro `web-push`, que recusa com
 * a mensagem dele — adivinhar mais que isso esconderia erro de digitação.
 */
function assunto(): string {
  const bruto = process.env.VAPID_SUBJECT?.trim();
  if (!bruto) return 'mailto:contato@inteliwa.com.br';
  if (/^(mailto:|https?:)/i.test(bruto)) return bruto;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bruto)) return `mailto:${bruto}`;
  return bruto;
}
