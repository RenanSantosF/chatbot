import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Troca o que muda de uma ocorrência pra outra (ids, números, e-mails)
 * por marcadores. "Conversa 3f2a... não encontrada" e "Conversa 91bc...
 * não encontrada" são o MESMO erro, e precisam virar uma linha só com a
 * contagem — senão o painel vira uma lista de mil linhas iguais.
 */
export function normalizar(texto: string): string {
  return texto
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '#',
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '@')
    .replace(/\d+/g, '#')
    .slice(0, 300);
}

export interface ErroParaRegistrar {
  origem: 'api' | 'web';
  mensagem: string;
  pilha?: string | null;
  rota?: string | null;
  status?: number | null;
  tenantId?: string | null;
  userId?: string | null;
}

@Injectable()
export class RegistroDeErros {
  private readonly logger = new Logger(RegistroDeErros.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Grava (ou soma a) um erro. Nunca lança — é chamado de dentro do tratamento de erro. */
  async registrar(erro: ErroParaRegistrar): Promise<void> {
    try {
      const mensagem = (erro.mensagem || 'Erro sem mensagem').slice(0, 500);
      const rota = erro.rota ? normalizar(erro.rota.split('?')[0]) : null;
      const assinatura = createHash('sha1')
        .update(`${erro.origem}|${normalizar(mensagem)}|${rota ?? ''}`)
        .digest('hex');
      const agora = new Date();
      const comum = {
        pilha: erro.pilha?.slice(0, 4000) ?? null,
        status: erro.status ?? null,
        tenantId: erro.tenantId ?? null,
        userId: erro.userId ?? null,
      };

      await this.prisma.client.erroDaPlataforma.upsert({
        where: { assinatura },
        create: { origem: erro.origem, assinatura, mensagem, rota, ...comum },
        update: {
          ...comum,
          mensagem,
          ocorrencias: { increment: 1 },
          ultimaVez: agora,
          // Voltou a acontecer depois de marcado como resolvido: não está.
          resolvido: false,
        },
      });
    } catch (falha) {
      this.logger.warn(
        `Não deu pra registrar um erro: ${falha instanceof Error ? falha.message : falha}`,
      );
    }
  }
}
