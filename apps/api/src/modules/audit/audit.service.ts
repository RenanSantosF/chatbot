import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

/** Quem fez a ação, do jeito que o controller já tem em mãos. */
export interface Autor {
  userId: string;
  name?: string | null;
}

export interface Registro {
  action: AuditAction;
  /** Já pronta pra tela — ver o comentário do campo `resumo` no schema. */
  resumo: string;
  conversationId?: string | null;
  snapshot?: Prisma.InputJsonValue;
}

/**
 * O caderninho da empresa.
 *
 * Uma porta só de escrita, e é de propósito que ela seja estreita: se
 * cada módulo montasse a própria linha, o histórico viraria uma mistura
 * de frases em três estilos, com metade das ações registradas e a outra
 * metade esquecida no meio de um `if`.
 *
 * NADA aqui lança. Auditoria é observação: se ela falhar, a ação que
 * estava sendo observada não pode falhar junto. Um erro ao gravar o
 * registro de uma transferência não pode impedir a transferência — seria
 * trocar um buraco no histórico por um atendimento parado.
 *
 * Em compensação, falhar em silêncio total seria pior ainda: um registro
 * que some sem ninguém saber é um registro em que não se pode confiar. Por
 * isso a falha vai pro log do servidor em nível de erro.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: TenantPrismaService) {}

  async registrar(autor: Autor | null, registro: Registro): Promise<void> {
    try {
      await this.prisma.db.auditLog.create({
        data: {
          tenantId: this.prisma.tenantId,
          action: registro.action,
          actorId: autor?.userId ?? null,
          // O nome congelado. Sem ele, remover alguém da equipe deixaria
          // o histórico inteiro dessa pessoa dizendo "—".
          actorName: autor?.name?.trim() || (autor ? 'Usuário removido' : 'Sistema'),
          conversationId: registro.conversationId ?? null,
          resumo: registro.resumo,
          ...(registro.snapshot !== undefined
            ? { snapshot: registro.snapshot }
            : {}),
        },
      });
    } catch (erro) {
      this.logger.error(
        `Não deu pra gravar no registro (${registro.action}): ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  /**
   * O histórico, do mais novo pro mais velho.
   *
   * Paginação por cursor e não por página: o registro CRESCE enquanto
   * alguém o lê — a equipe continua trabalhando — e numerar páginas faria
   * linhas novas empurrarem as antigas pra frente, repetindo e pulando
   * itens a cada avanço.
   */
  async listar(filtros: {
    action?: AuditAction;
    actorId?: string;
    conversationId?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limite = Math.min(Math.max(filtros.limit ?? 50, 1), 100);

    const itens = await this.prisma.db.auditLog.findMany({
      where: {
        ...(filtros.action ? { action: filtros.action } : {}),
        ...(filtros.actorId ? { actorId: filtros.actorId } : {}),
        ...(filtros.conversationId
          ? { conversationId: filtros.conversationId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limite + 1,
      ...(filtros.cursor
        ? { cursor: { id: filtros.cursor }, skip: 1 }
        : {}),
    });
    /*
     * Sem `include` de conversa, e não é esquecimento.
     *
     * `conversationId` é uma coluna solta, sem chave estrangeira, de
     * propósito: com relação, apagar uma conversa levaria o registro dela
     * junto (cascade) ou o esvaziaria (set null) — e o histórico existe
     * justamente pra sobreviver ao que foi apagado.
     *
     * O nome do cliente que a tela mostra vem do `resumo`, congelado na
     * gravação. O id continua servindo de atalho pra abrir a conversa
     * quando ela ainda existe.
     */

    const temMais = itens.length > limite;
    return {
      items: temMais ? itens.slice(0, limite) : itens,
      nextCursor: temMais ? itens[limite - 1].id : null,
    };
  }
}
