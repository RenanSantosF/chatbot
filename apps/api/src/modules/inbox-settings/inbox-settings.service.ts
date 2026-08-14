import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateInboxSettingsDto } from './dto/inbox-settings.dto';

@Injectable()
export class InboxSettingsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * A configuração já lida nesta requisição.
   *
   * Ela é consultada VÁRIAS vezes no mesmo pedido: responder uma mensagem
   * passa por aqui pra saber se assina com o nome de quem respondeu, se
   * reabre a conversa encerrada, se manda confirmação de leitura e se avisa
   * ao resolver — quatro idas ao banco pela mesma linha, que não muda no
   * meio de uma requisição.
   *
   * O serviço é de escopo de requisição (depende do TenantPrismaService),
   * então este cache nasce e morre com o pedido: não há como servir a
   * configuração de uma empresa pra outra, nem entregar valor velho depois
   * de alguém salvar a tela de Atendimento.
   */
  private emCache?: Promise<Awaited<ReturnType<typeof this.buscar>>>;

  /**
   * Cria com os padrões na primeira leitura em vez de semear no registro do
   * tenant: assim empresas criadas antes desta tela existirem também
   * ganham a configuração sem migração de dados.
   */
  private async buscar() {
    const existing = await this.prisma.db.inboxSettings.findFirst();
    if (existing) return existing;
    return this.prisma.db.inboxSettings.create({
      data: { tenantId: this.prisma.tenantId },
    });
  }

  get() {
    // A PROMESSA é guardada, não o resultado: duas leituras disparadas no
    // mesmo instante (o `Promise.all` do envio faz isso) compartilham a
    // mesma consulta em vez de criarem duas linhas na corrida do primeiro
    // acesso.
    this.emCache ??= this.buscar();
    return this.emCache;
  }

  async update(dto: UpdateInboxSettingsDto) {
    const current = await this.get();
    const atualizada = await this.prisma.db.inboxSettings.update({
      where: { id: current.id },
      data: dto,
    });
    // Quem escreveu não pode continuar lendo o de antes no resto do pedido.
    this.emCache = Promise.resolve(atualizada);
    return atualizada;
  }
}
