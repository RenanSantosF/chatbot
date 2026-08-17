import { Controller, Get, Query } from '@nestjs/common';
import type { AuditAction } from '../../../generated/prisma/client';
import { Roles } from '../../common/auth/roles.decorator';
import { AuditService } from './audit.service';

/**
 * Só leitura, e só pra quem responde pela empresa.
 *
 * Não existe POST, PATCH nem DELETE aqui, e a ausência é o recurso: um
 * registro que o registrado consegue mexer não registra nada. Gravar é
 * consequência de outra ação, sempre — nunca uma chamada que alguém possa
 * fazer de fora.
 *
 * `@Roles` em vez de uma permissão do catálogo porque isto não é uma
 * atribuição que se delega: quem pode ver o que a equipe fez é quem
 * responde pela equipe. Um atendente com "ver o registro" ligado por
 * engano leria as mensagens que os colegas apagaram.
 */
@Controller('audit')
@Roles('OWNER', 'ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  listar(
    @Query('action') action: AuditAction | undefined,
    @Query('actorId') actorId: string | undefined,
    @Query('conversationId') conversationId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    return this.audit.listar({
      action,
      actorId,
      conversationId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
