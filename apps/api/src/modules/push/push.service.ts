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
   * Sem as chaves VAPID o recurso fica desligado, e isso é proposital.
   *
   * São elas que provam ao serviço de push que o envio veio de quem a
   * pessoa autorizou. Sem elas não há como enviar — e o resto do sistema
   * tem que continuar funcionando igual, como já acontece com o
   * armazenamento de anexos e com o ffmpeg.
   */
  private readonly ligado: boolean;

  constructor(private readonly prisma: PrismaService) {
    const publica = process.env.VAPID_PUBLIC_KEY;
    const privada = process.env.VAPID_PRIVATE_KEY;
    this.ligado = Boolean(publica && privada);

    if (this.ligado) {
      webpush.setVapidDetails(
        // O `subject` é um contato do responsável pelo serviço, exigido
        // pela norma: é por onde o serviço de push avisa em caso de abuso.
        process.env.VAPID_SUBJECT ?? 'mailto:contato@inteliwa.com.br',
        publica!,
        privada!,
      );
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes: o aviso com o app fechado fica desligado. ' +
          'Gere o par com `npx web-push generate-vapid-keys` e configure nas variáveis de ambiente.',
      );
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
