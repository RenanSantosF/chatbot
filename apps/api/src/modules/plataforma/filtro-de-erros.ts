import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type HttpServer,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RegistroDeErros } from './registro-de-erros.service';

/**
 * Todo erro 5xx da API vai pro painel da plataforma, e a resposta segue
 * exatamente como antes (quem responde é o filtro padrão do Nest).
 *
 * Só os inesperados: 4xx é o sistema dizendo "não" de propósito (sem
 * permissão, dado inválido, conversa de outro setor) — registrá-los
 * afogaria os erros de verdade em recusas normais.
 */
@Catch()
export class FiltroDeErros extends BaseExceptionFilter {
  constructor(
    adaptador: HttpServer,
    private readonly registro: RegistroDeErros,
  ) {
    super(adaptador);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500 && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<AuthenticatedRequest>();
      const erro =
        exception instanceof Error ? exception : new Error(String(exception));
      void this.registro.registrar({
        origem: 'api',
        mensagem: erro.message,
        pilha: erro.stack,
        rota: `${req.method} ${(req as { route?: { path?: string } }).route?.path ?? req.url}`,
        status,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });
    }

    super.catch(emPortugues(exception, status), host);
  }
}

/**
 * As duas recusas que o próprio Nest escreve, e escreve em inglês.
 *
 * O painel mostra a mensagem da API como veio: quem passava do limite de
 * tentativas lia "ThrottlerException: Too Many Requests", e quem mandava
 * um arquivo grande demais, "File too large".
 */
export function emPortugues(exception: unknown, status: number): unknown {
  if (status === HttpStatus.TOO_MANY_REQUESTS) {
    return new HttpException(
      'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
      status,
    );
  }
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
    return new HttpException(
      'O arquivo passa do tamanho máximo permitido.',
      status,
    );
  }
  return exception;
}
