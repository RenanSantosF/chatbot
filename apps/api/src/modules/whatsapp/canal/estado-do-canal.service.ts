import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * O WhatsApp desta empresa está de pé AGORA?
 *
 * Existe porque a resposta estava em três lugares que discordavam, e cada
 * desacordo aparecia como um defeito diferente no painel:
 *
 * 1. A faixa de "WhatsApp desconectado" só nascia de um EVENTO de tempo
 *    real. Quem abria o painel com a sessão já caída não via nada — o
 *    evento tinha passado antes de a página existir. O aviso aparecia por
 *    acaso, quando calhava de a sessão oscilar com a aba aberta, e era
 *    isso que fazia ele "aparecer só às vezes, raramente".
 *
 * 2. A tela de configurações do WhatsApp perguntava direto ao banco e
 *    acertava — daí a contradição de uma tela avisar e a outra não.
 *
 * 3. O passo "Conectar o WhatsApp" dos primeiros passos olhava SÓ a
 *    configuração da Meta. Empresa conectada por QR code nunca cria
 *    aquela linha, então o item ficava eternamente por fazer, mesmo com o
 *    WhatsApp funcionando e conversando.
 *
 * Uma pergunta, uma resposta, e ela sabe dos dois provedores.
 */
/**
 * Até quando faz sentido dizer "trazendo as conversas".
 *
 * Ninguém garante que o aparelho vá mandar o lote final: ele pode ter
 * pouca coisa, pode estar sem bateria, o servidor pode ter reiniciado no
 * meio. Sem um limite, "importando" fica pra sempre — foi exatamente o
 * que aconteceu: quase uma hora girando.
 *
 * A conta é feita na LEITURA, e não por um cronômetro no navegador. Um
 * `setTimeout` de três minutos era o que existia antes, e ele falha de
 * dois jeitos que este não falha: some ao recarregar a página, e numa aba
 * de celular em segundo plano o Chrome congela o temporizador — ele nunca
 * dispara, e o giro fica eterno mesmo com a importação encerrada.
 */
const HISTORICO_PACIENCIA_MS = 10 * 60_000;

@Injectable()
export class EstadoDoCanalService {
  constructor(private readonly prisma: PrismaService) {}

  async doTenant(tenantId: string): Promise<EstadoDoCanal> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { canal: true },
    });

    if (tenant?.canal === 'EVOLUTION') {
      const config = await this.prisma.client.evolutionSettings.findFirst({
        where: { tenantId },
        select: {
          estado: true,
          lastError: true,
          historicoEstado: true,
          historicoMensagens: true,
          historicoIniciadoEm: true,
        },
      });

      return {
        provedor: 'EVOLUTION',
        // Sem linha nenhuma, a empresa escolheu a Evolution e ainda não
        // pareou: "nunca conectou" é diferente de "caiu", e a tela dos
        // primeiros passos precisa dessa diferença.
        estado: config?.estado ?? 'DESCONECTADO',
        motivo: config?.lastError ?? null,
        jaConectou: Boolean(config),
        historico: {
          importando: sincronizando(config),
          mensagens: config?.historicoMensagens ?? 0,
        },
      };
    }

    const oficial = await this.prisma.client.whatsAppSettings.findFirst({
      where: { tenantId },
      select: { id: true },
    });

    return {
      provedor: 'META_CLOUD',
      /*
       * No caminho oficial não existe "sessão caída".
       *
       * A Cloud API não tem aparelho vinculado: se as credenciais estão
       * gravadas, ela responde. Quando não responde é por token vencido ou
       * número sem permissão — e isso só se descobre TENTANDO enviar, o
       * que já vira o motivo da falha no balão.
       *
       * Dizer "desconectado" aqui seria um alarme que ninguém consegue
       * confirmar nem resolver.
       */
      estado: oficial ? 'CONECTADO' : 'DESCONECTADO',
      motivo: null,
      jaConectou: Boolean(oficial),
      // A Cloud API não tem aparelho de onde puxar conversa antiga: o
      // histórico dela, quando existe, vem por outro caminho e já está
      // gravado. Nada a esperar.
      historico: { importando: false, mensagens: 0 },
    };
  }
}

/**
 * Ainda vale dizer que as conversas estão vindo?
 *
 * Só enquanto o estado é IMPORTANDO **e** a janela de paciência não
 * venceu. As duas condições precisam existir: a primeira some quando o
 * aparelho avisa que mandou o último lote, e a segunda cobre o caso — que
 * é o comum — em que esse aviso nunca chega.
 */
function sincronizando(
  config: {
    historicoEstado: 'NUNCA' | 'IMPORTANDO' | 'CONCLUIDO';
    historicoIniciadoEm: Date | null;
  } | null,
): boolean {
  if (config?.historicoEstado !== 'IMPORTANDO') return false;
  if (!config.historicoIniciadoEm) return false;
  return Date.now() - config.historicoIniciadoEm.getTime() < HISTORICO_PACIENCIA_MS;
}

export interface EstadoDoCanal {
  provedor: 'META_CLOUD' | 'EVOLUTION';
  estado: 'CONECTADO' | 'AGUARDANDO_QRCODE' | 'DESCONECTADO';
  /** Por que caiu, quando o provedor sabe dizer. */
  motivo: string | null;
  /** Já houve conexão alguma vez? Separa "nunca configurou" de "caiu". */
  jaConectou: boolean;
  /** As conversas do aparelho ainda estão chegando? */
  historico: {
    importando: boolean;
    /** Quantas vieram até agora, pra tela ter o que mostrar de progresso. */
    mensagens: number;
  };
}
