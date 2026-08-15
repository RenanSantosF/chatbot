import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { SalvarPerfilDto } from './dto/onboarding.dto';

/**
 * A primeira entrada da empresa no sistema.
 *
 * Duas coisas moram aqui, e elas resolvem problemas diferentes.
 *
 * O PERFIL é o que a empresa conta sobre si — quantos atendem, há quanto
 * tempo existe, qual o porte. Perguntado depois do cadastro, e não durante:
 * campo a mais na tela de criar conta derruba conversão, e perguntar
 * faturamento antes de a pessoa ver o produto funcionando parece
 * qualificação pra ligação de vendas.
 *
 * O PROGRESSO é o que decide se a conta vai virar cliente pagante. Não
 * adianta a pessoa criar a conta e sumir: enquanto o WhatsApp não estiver
 * conectado e a primeira conversa não tiver acontecido, ela não viu valor
 * nenhum — e não vai pagar por nada. Por isso ele é CALCULADO do estado
 * real do sistema, nunca de uma lista de "já cliquei aqui": marcar como
 * feito o que não foi feito é enganar a única métrica que importa nesta
 * fase.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly global: PrismaService,
    private readonly prisma: TenantPrismaService,
  ) {}

  async salvarPerfil(dto: SalvarPerfilDto) {
    const tenant = await this.global.client.tenant.update({
      where: { id: this.prisma.tenantId },
      data: {
        profile: {
          ...dto,
          respondidoEm: new Date().toISOString(),
        } as Prisma.InputJsonValue,
        // Responder OU dispensar concluem a boas-vindas. Insistir com quem
        // já disse que não quer responder é o caminho mais curto pra pessoa
        // associar o produto a chateação.
        onboardedAt: new Date(),
      },
      select: { profile: true, onboardedAt: true },
    });

    return tenant;
  }

  /** Dispensou sem responder. Vale como concluído. */
  async dispensar() {
    return this.global.client.tenant.update({
      where: { id: this.prisma.tenantId },
      data: { onboardedAt: new Date() },
      select: { onboardedAt: true },
    });
  }

  /**
   * O que falta pra empresa estar de fato atendendo.
   *
   * Cada item é uma pergunta ao banco, não uma caixinha que alguém marcou.
   * Se o WhatsApp foi desconectado depois, o passo volta a ficar pendente —
   * que é a verdade, e é o que precisa ser dito.
   */
  async progresso() {
    const [whatsapp, ia, equipe, conversas, tenant] = await Promise.all([
      this.prisma.db.whatsAppSettings.findFirst({ select: { id: true } }),
      this.prisma.db.aiSettings.findFirst({
        select: { active: true, apiKeyEncrypted: true },
      }),
      this.prisma.db.user.count(),
      this.prisma.db.conversation.count(),
      this.global.client.tenant.findUnique({
        where: { id: this.prisma.tenantId },
        select: { profile: true, onboardedAt: true },
      }),
    ]);

    const passos = [
      {
        chave: 'whatsapp',
        titulo: 'Conectar o WhatsApp',
        descricao: 'Sem isso o painel não recebe nem envia mensagem nenhuma.',
        destino: '/dashboard/settings/whatsapp',
        feito: Boolean(whatsapp),
      },
      {
        chave: 'ia',
        titulo: 'Ligar a inteligência artificial',
        descricao: 'Ela responde o repetitivo e chama a equipe quando precisa.',
        destino: '/dashboard/settings/ai',
        feito: Boolean(ia?.active && ia.apiKeyEncrypted),
      },
      {
        chave: 'equipe',
        titulo: 'Chamar quem vai atender',
        descricao: 'Cada pessoa com o próprio acesso, e o histórico dizendo quem respondeu o quê.',
        destino: '/dashboard/settings/team',
        // Um usuário é o dono, que já existe desde o cadastro.
        feito: equipe > 1,
      },
      {
        chave: 'conversa',
        titulo: 'Receber a primeira conversa',
        descricao: 'Mande uma mensagem pro seu próprio número e veja ela chegar aqui.',
        destino: '/dashboard/inbox',
        feito: conversas > 0,
      },
    ];

    return {
      passos,
      concluidos: passos.filter((passo) => passo.feito).length,
      total: passos.length,
      // Quem respondeu (ou dispensou) as perguntas não vê a boas-vindas de novo.
      precisaDeBoasVindas: !tenant?.onboardedAt,
      perfil: tenant?.profile ?? null,
    };
  }
}
