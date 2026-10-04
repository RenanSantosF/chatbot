import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { EmailService } from '../../common/email/email.service';
import {
  enderecoDoPainel,
  montarEmail,
} from '../../common/email/modelo-de-email';
import { PrismaService } from '../../common/prisma/prisma.service';
import { emailsDaPlataforma } from '../plataforma/plataforma.guard';
import { RegistroDeEventos } from '../plataforma/registro-de-eventos.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import * as evolution from '../whatsapp/canal/evolution/evolution.client';

/** De dois em dois minutos. */
const INTERVALO_MS = 2 * 60 * 1000;

/**
 * Quanto tempo a sessão precisa ficar caída antes de alguém ser avisado.
 *
 * O WhatsApp oscila: rede do celular, reinício do servidor, o próprio
 * protocolo pedindo reconexão. A maioria volta sozinha em segundos, e
 * mandar e-mail por cada piscada ensinaria o dono a ignorar o aviso — que
 * é o pior destino de um alarme. Cinco minutos caído já não é piscada.
 */
export const TOLERANCIA_MS = 5 * 60 * 1000;

/** A pergunta "a sessão está de pé?" não pode segurar a passada inteira. */
const TEMPO_DA_CONFERENCIA_MS = 10_000;

const CAMINHO_DA_CONEXAO = '/dashboard/settings/whatsapp';

interface Sessao {
  id: string;
  tenantId: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  instance: string;
  estado: string;
  lastError: string | null;
  quedaDesde: Date | null;
  quedaAvisadaEm: Date | null;
}

/**
 * Avisa o dono quando o WhatsApp da empresa cai e não volta.
 *
 * É o ponto fraco da conexão por QR code: a sessão cai de madrugada, a IA
 * para de responder e ninguém fica sabendo até um cliente reclamar. A
 * faixa vermelha do painel só serve a quem está com o painel aberto.
 *
 * Duas fontes dizem que caiu, e as duas são necessárias:
 *
 * 1. O estado gravado pelo webhook (a Evolution avisou o `close`).
 * 2. A pergunta direta ao servidor, pra sessão marcada como conectada.
 *    O aviso do webhook pode não chegar — servidor reiniciado, entrega
 *    perdida —, e aí a sessão constava "conectada" pra sempre.
 *
 * Quando o que não responde é o SERVIDOR de mensagens, a culpa não é de
 * nenhuma empresa e não há nada que o dono possa fazer: quem é avisado é
 * a plataforma (PLATFORM_ADMIN_EMAILS).
 *
 * Desconectar pelo botão não é queda: ele zera `lastError`, e só a queda
 * de verdade grava um motivo.
 */
@Injectable()
export class VigiaDoWhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VigiaDoWhatsappService.name);
  private timer?: NodeJS.Timeout;
  private rodando = false;

  /** Servidor de mensagens sem responder, desde quando. */
  private readonly servidorForaDesde = new Map<string, number>();
  private readonly servidorAvisado = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly email: EmailService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
    @Optional() private readonly eventos?: RegistroDeEventos,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.vigiar(), INTERVALO_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async vigiar(agora = new Date()): Promise<void> {
    // Uma passada lenta (servidor fora, cada pergunta esperando o tempo
    // limite) não pode empilhar com a seguinte.
    if (this.rodando) return;
    this.rodando = true;
    try {
      const sessoes = await this.prisma.client.evolutionSettings.findMany({
        where: {
          // Já esteve de pé alguma vez: quem nunca pareou não "caiu".
          lastSeenAt: { not: null },
          tenant: { status: { not: 'SUSPENDED' } },
        },
        select: {
          id: true,
          tenantId: true,
          baseUrl: true,
          apiKeyEncrypted: true,
          instance: true,
          estado: true,
          lastError: true,
          quedaDesde: true,
          quedaAvisadaEm: true,
        },
      });

      const servidoresFora = new Set<string>();
      const servidoresOk = new Set<string>();

      for (const sessao of sessoes) {
        try {
          const situacao = await this.situacao(sessao, servidoresFora);
          if (situacao === 'servidor-fora') continue;
          if (situacao !== 'caiu') servidoresOk.add(sessao.baseUrl);
          await this.registrar(sessao, situacao === 'caiu', agora);
        } catch (erro) {
          this.logger.warn(
            `Vigia: falha ao conferir a sessão ${sessao.instance}: ${String(erro)}`,
          );
        }
      }

      await this.acompanharServidores(servidoresFora, servidoresOk, agora);
    } finally {
      this.rodando = false;
    }
  }

  private async situacao(
    sessao: Sessao,
    servidoresFora: Set<string>,
  ): Promise<'de-pe' | 'caiu' | 'servidor-fora'> {
    if (sessao.estado === 'DESCONECTADO') {
      // Sem motivo gravado é o botão "Desconectar": foi escolha, não queda.
      return sessao.lastError ? 'caiu' : 'de-pe';
    }
    // Lendo o QR code: alguém está reconectando agora.
    if (sessao.estado !== 'CONECTADO') return 'de-pe';

    // Um servidor que não respondeu nesta passada não responde às outras
    // sessões dele: perguntar de novo seria esperar o tempo limite N vezes.
    if (servidoresFora.has(sessao.baseUrl)) return 'servidor-fora';

    const resposta = await evolution.estado(
      {
        baseUrl: sessao.baseUrl,
        apiKey: this.encryption.decrypt(sessao.apiKeyEncrypted),
        instance: sessao.instance,
      },
      TEMPO_DA_CONFERENCIA_MS,
    );

    if (!resposta.ok && resposta.status === undefined) {
      servidoresFora.add(sessao.baseUrl);
      return 'servidor-fora';
    }
    // Recusa com status (a sessão não existe mais lá, chave trocada) é
    // problema desta empresa, não do servidor.
    const estado = resposta.ok ? resposta.dados?.instance?.state : 'close';
    if (estado !== 'close') return 'de-pe';

    // Constava conectada, mas o servidor diz que não: o aviso do webhook
    // se perdeu. Corrige o que está gravado e a tela de quem está no
    // painel, do mesmo jeito que o webhook faria.
    const lastError = resposta.ok
      ? 'a sessão caiu no servidor de mensagens'
      : `o servidor de mensagens recusou a sessão (${resposta.erro ?? 'sem motivo'})`;
    await this.prisma.client.evolutionSettings.update({
      where: { id: sessao.id },
      data: { estado: 'DESCONECTADO', lastError },
    });
    this.realtime.emitToTenant(sessao.tenantId, 'canal.estado', {
      estado: 'DESCONECTADO',
      lastError,
    });
    sessao.lastError = lastError;
    return 'caiu';
  }

  private async registrar(sessao: Sessao, caiu: boolean, agora: Date) {
    if (!caiu) {
      if (sessao.quedaDesde || sessao.quedaAvisadaEm) {
        await this.prisma.client.evolutionSettings.update({
          where: { id: sessao.id },
          data: { quedaDesde: null, quedaAvisadaEm: null },
        });
        // Só conta como volta a queda que chegou a ser avisada: piscada de
        // segundos não é incidente.
        if (sessao.quedaAvisadaEm && sessao.quedaDesde) {
          await this.eventos?.registrar('whatsapp_voltou', {
            tenantId: sessao.tenantId,
            dados: {
              minutosFora: Math.round(
                (agora.getTime() - sessao.quedaDesde.getTime()) / 60_000,
              ),
            },
          });
        }
      }
      return;
    }

    if (!sessao.quedaDesde) {
      await this.prisma.client.evolutionSettings.update({
        where: { id: sessao.id },
        data: { quedaDesde: agora },
      });
      return;
    }

    const caidaHa = agora.getTime() - sessao.quedaDesde.getTime();
    if (sessao.quedaAvisadaEm || caidaHa < TOLERANCIA_MS) return;

    // Marca antes de avisar: se o envio travar e a passada seguinte
    // começar, ela não manda o mesmo aviso de novo.
    const { count } = await this.prisma.client.evolutionSettings.updateMany({
      where: { id: sessao.id, quedaAvisadaEm: null },
      data: { quedaAvisadaEm: agora },
    });
    if (count === 0) return;

    await this.eventos?.registrar('whatsapp_caiu', {
      tenantId: sessao.tenantId,
      dados: { motivo: sessao.lastError },
    });
    await this.avisarEmpresa(sessao);
  }

  private async avisarEmpresa(sessao: Sessao) {
    const [tenant, pessoas] = await Promise.all([
      this.prisma.client.tenant.findUnique({
        where: { id: sessao.tenantId },
        select: { name: true },
      }),
      this.prisma.client.user.findMany({
        where: {
          tenantId: sessao.tenantId,
          status: 'ACTIVE',
          role: { in: ['OWNER', 'ADMIN'] },
        },
        select: { id: true, name: true, email: true, role: true },
      }),
    ]);

    const motivo = sessao.lastError ?? 'a sessão caiu';
    const desvinculado = motivo.includes('desvinculado');
    const url = enderecoDoPainel(CAMINHO_DA_CONEXAO);

    await this.push.avisarPessoas(
      sessao.tenantId,
      {
        titulo: 'O WhatsApp da empresa desconectou',
        corpo: desvinculado
          ? 'Leia o QR code de novo para voltar a receber mensagens.'
          : 'As mensagens não estão chegando. Toque para reconectar.',
        url: CAMINHO_DA_CONEXAO,
        tag: 'whatsapp-caiu',
      },
      pessoas.map((p) => p.id),
    );

    // E-mail só pro dono: é ele quem paga e quem tem o celular do número.
    for (const dono of pessoas.filter((p) => p.role === 'OWNER')) {
      const nome = dono.name.split(' ')[0] || dono.name;
      await this.email.enviar({
        para: dono.email,
        assunto: 'O WhatsApp da sua empresa desconectou',
        ...montarEmail({
          tom: 'alerta',
          saudacao: `Olá, ${nome}!`,
          paragrafos: [
            `O WhatsApp de ${tenant?.name ?? 'sua empresa'} está desconectado da Inteliwa há mais de 5 minutos (${motivo}).`,
            'Enquanto ele estiver assim, as mensagens dos clientes não chegam ao painel e a IA não responde ninguém.',
            desvinculado
              ? 'Para voltar, abra a tela de conexão e leia o QR code com o celular do número da empresa.'
              : 'Na maioria das vezes basta o celular do número estar ligado e com internet. Se não voltar sozinho, abra a tela de conexão e leia o QR code de novo.',
          ],
          botao: { texto: 'Reconectar o WhatsApp', url },
          rodape:
            'Você recebe este aviso por ser o responsável pela conta. Ele sai uma vez por queda.',
        }),
      });
    }

    this.logger.warn(
      `Tenant ${sessao.tenantId}: WhatsApp caído há mais de 5 minutos; dono avisado.`,
    );
  }

  /** O servidor de mensagens inteiro sem responder: avisa a plataforma. */
  private async acompanharServidores(
    fora: Set<string>,
    ok: Set<string>,
    agora: Date,
  ) {
    for (const servidor of ok) {
      this.servidorForaDesde.delete(servidor);
      this.servidorAvisado.delete(servidor);
    }

    for (const servidor of fora) {
      const desde = this.servidorForaDesde.get(servidor) ?? agora.getTime();
      this.servidorForaDesde.set(servidor, desde);
      if (
        agora.getTime() - desde < TOLERANCIA_MS ||
        this.servidorAvisado.has(servidor)
      ) {
        continue;
      }
      this.servidorAvisado.add(servidor);
      this.logger.error(
        `Servidor de mensagens ${servidor} sem responder há mais de 5 minutos.`,
      );

      for (const para of emailsDaPlataforma()) {
        await this.email.enviar({
          para,
          assunto: 'Servidor de mensagens (Evolution) fora do ar',
          ...montarEmail({
            tom: 'alerta',
            saudacao: 'Alerta da plataforma',
            paragrafos: [
              `O servidor de mensagens ${servidor} não responde há mais de 5 minutos.`,
              'Enquanto ele estiver fora, nenhuma empresa conectada a ele recebe ou envia mensagens. Confira o serviço da Evolution no Railway.',
            ],
            rodape: 'Aviso enviado uma vez por queda do servidor.',
          }),
        });
      }
    }
  }
}
