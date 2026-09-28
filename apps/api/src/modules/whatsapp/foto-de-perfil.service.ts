import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { EvolutionCanal } from './canal/evolution/evolution.canal';

/**
 * Quanto tempo uma foto conferida vale quando a conversa é só ABERTA.
 *
 * Mais curto que a conferência do webhook (um dia): abrir a conversa é o
 * momento em que alguém está olhando pra cara do cliente, e uma foto
 * trocada de manhã não deveria esperar até amanhã pra aparecer.
 */
export const FOTO_VALIDA_AO_ABRIR_MS = 6 * 60 * 60 * 1000;

/**
 * Pedido explícito (clique na foto) também tem um piso: dois cliques
 * seguidos não viram duas perguntas ao WhatsApp.
 */
export const INTERVALO_MINIMO_MS = 30 * 1000;

/**
 * A foto de perfil buscada NA HORA, a pedido da tela.
 *
 * Até aqui ela só era conferida quando o cliente mandava mensagem — então
 * quem já estava na lista antes disso (o histórico importado, a agenda,
 * quem não escreve há dias) nunca ganhava foto, por mais que a conversa
 * fosse aberta. Agora abrir a conversa confere se a foto está velha, e
 * clicar nela busca de novo sempre (com um piso de meio minuto).
 *
 * Só o canal por QR code tem de onde tirar a foto; na API oficial da Meta
 * a pergunta volta `undefined` e a resposta é a foto que já havia.
 */
@Injectable()
export class FotoDePerfilService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly evolution: EvolutionCanal,
  ) {}

  async atualizar(
    customerId: string,
    { forcar = false }: { forcar?: boolean } = {},
  ): Promise<{ avatarUrl: string | null }> {
    const cliente = await this.prisma.db.customer.findFirst({
      where: { id: customerId },
      select: {
        id: true,
        phone: true,
        avatarUrl: true,
        avatarVerificadoEm: true,
      },
    });
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

    const idade = cliente.avatarVerificadoEm
      ? Date.now() - cliente.avatarVerificadoEm.getTime()
      : Infinity;
    const validade = forcar ? INTERVALO_MINIMO_MS : FOTO_VALIDA_AO_ABRIR_MS;
    if (idade < validade) return { avatarUrl: cliente.avatarUrl };

    const foto = await this.evolution.fotoDePerfil(cliente.phone);
    // A pergunta falhou (sem canal, WhatsApp fora): fica a foto que havia,
    // e nada é gravado — a próxima abertura tenta de novo.
    if (foto === undefined) return { avatarUrl: cliente.avatarUrl };

    await this.prisma.db.customer.update({
      where: { id: cliente.id },
      data: { avatarUrl: foto, avatarVerificadoEm: new Date() },
    });
    return { avatarUrl: foto };
  }
}
