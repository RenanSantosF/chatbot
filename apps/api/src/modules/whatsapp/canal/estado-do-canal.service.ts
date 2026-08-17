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
        select: { estado: true, lastError: true },
      });

      return {
        provedor: 'EVOLUTION',
        // Sem linha nenhuma, a empresa escolheu a Evolution e ainda não
        // pareou: "nunca conectou" é diferente de "caiu", e a tela dos
        // primeiros passos precisa dessa diferença.
        estado: config?.estado ?? 'DESCONECTADO',
        motivo: config?.lastError ?? null,
        jaConectou: Boolean(config),
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
    };
  }
}

export interface EstadoDoCanal {
  provedor: 'META_CLOUD' | 'EVOLUTION';
  estado: 'CONECTADO' | 'AGUARDANDO_QRCODE' | 'DESCONECTADO';
  /** Por que caiu, quando o provedor sabe dizer. */
  motivo: string | null;
  /** Já houve conexão alguma vez? Separa "nunca configurou" de "caiu". */
  jaConectou: boolean;
}
