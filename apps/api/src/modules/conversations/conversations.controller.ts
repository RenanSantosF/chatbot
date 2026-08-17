import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import type {
  AuditAction,
  ConversationPriority,
  ConversationStatus,
  Prisma,
} from '../../../generated/prisma/client';
import type { RequestUser } from '../auth/auth.types';
import { TranscricaoService } from '../ai/transcricao.service';
import { AuditService } from '../audit/audit.service';
import {
  ConversationsService,
  type OrdemDoInbox,
  type StatusGroup,
} from './conversations.service';
import { IniciarConversaDto } from './dto/iniciar-conversa.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SetPriorityDto } from './dto/set-priority.dto';
import { SimulateInboundDto } from './dto/simulate-inbound.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly transcricao: TranscricaoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * O registro é feito AQUI, na borda, e não lá dentro do serviço.
   *
   * Dois motivos. O primeiro é que só aqui se sabe QUEM fez: os métodos do
   * serviço são chamados também pela IA e pelo webhook, e creditar uma
   * transferência automática a uma pessoa seria pior que não registrar
   * nada. O segundo é que só se registra o que DEU CERTO — uma
   * transferência que morreu numa exceção não chega nesta linha.
   */
  private async registrar(
    user: RequestUser,
    action: AuditAction,
    conversationId: string,
    resumo: string,
    snapshot?: Prisma.InputJsonValue,
  ) {
    await this.audit.registrar(
      { userId: user.userId, name: user.name },
      { action, conversationId, resumo, ...(snapshot ? { snapshot } : {}) },
    );
  }

  /** O nome que a linha do registro vai mostrar meses depois. */
  private nomeDoCliente(conversa: { customer?: { name?: string | null } | null }) {
    return conversa.customer?.name ?? 'cliente sem nome';
  }

  @Get()
  list(
    @Query('status') status: ConversationStatus | undefined,
    @Query('statusGroup') statusGroup: StatusGroup | undefined,
    @Query('mine') mine: string | undefined,
    @Query('queueId') queueId: string | undefined,
    @Query('customerId') customerId: string | undefined,
    @Query('priority') priority: ConversationPriority | undefined,
    @Query('unread') unread: string | undefined,
    @Query('unassigned') unassigned: string | undefined,
    @Query('comIa') comIa: string | undefined,
    @Query('search') search: string | undefined,
    @Query('ordem') ordem: OrdemDoInbox | undefined,
    @Query('waiting') waiting: string | undefined,
    @Query('tagId') tagId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.list({
      status,
      statusGroup,
      assignedUserId: mine === 'true' ? user.userId : undefined,
      unassignedOnly: unassigned === 'true',
      comIa: comIa === 'true',
      queueId,
      customerId,
      priority,
      unreadOnly: unread === 'true',
      waitingOnly: waiting === 'true',
      tagId,
      search,
      ordem: ordem === 'ESPERA' ? 'ESPERA' : 'RECENTE',
      cursor,
      limit: limit ? Number(limit) : undefined,
      viewer: { userId: user.userId, role: user.role },
    });
  }

  /**
   * Os mesmos parâmetros da listagem, de propósito.
   *
   * A barra manda o recorte que está na tela, e cada contador responde
   * "quantas eu veria se ligasse isto, mantendo o resto". Sem receber os
   * filtros, o cabeçalho contava a empresa inteira enquanto a lista
   * mostrava um recorte — e os dois números na mesma tela se
   * contradiziam.
   */
  @Get('counts')
  counts(
    @Query('status') status: ConversationStatus | undefined,
    @Query('statusGroup') statusGroup: StatusGroup | undefined,
    @Query('mine') mine: string | undefined,
    @Query('queueId') queueId: string | undefined,
    @Query('priority') priority: ConversationPriority | undefined,
    @Query('unread') unread: string | undefined,
    @Query('unassigned') unassigned: string | undefined,
    @Query('waiting') waiting: string | undefined,
    @Query('comIa') comIa: string | undefined,
    @Query('tagId') tagId: string | undefined,
    @Query('search') search: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.counts({
      status,
      statusGroup,
      assignedUserId: mine === 'true' ? user.userId : undefined,
      queueId,
      priority,
      unreadOnly: unread === 'true',
      unassignedOnly: unassigned === 'true',
      waitingOnly: waiting === 'true',
      comIa: comIa === 'true',
      tagId,
      search,
      viewer: { userId: user.userId, role: user.role },
    });
  }

  // Estas rotas ficam ANTES de ':id' de propósito: o Nest casa na ordem
  // de declaração, e ':id' engoliria 'templates', devolvendo
  // "conversa não encontrada" pra uma rota que existe.
  @Get('templates')
  templates() {
    return this.conversationsService.listTemplates();
  }

  @Post('start')
  @RequiresPermission('conversations.send')
  start(
    @Body() dto: StartConversationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.startConversation(dto, user.userId);
  }

  /**
   * Puxar conversa com quem nunca escreveu, escrevendo de verdade.
   *
   * Fica antes de `:id` de propósito: o Nest casa na ordem de
   * declaração, e `:id` engoliria "iniciar" como se fosse um id.
   */
  @Post('iniciar')
  @RequiresPermission('conversations.send')
  async iniciar(
    @Body() dto: IniciarConversaDto,
    @CurrentUser() user: RequestUser,
  ) {
    const conversa = await this.conversationsService.iniciarConversa(
      dto,
      user.userId,
    );
    if (conversa) {
      await this.registrar(
        user,
        'CONVERSA_ATRIBUIDA',
        conversa.id,
        `Iniciou uma conversa com ${this.nomeDoCliente(conversa)}.`,
      );
    }
    return conversa;
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.conversationsService.getById(id);
  }

  /** Páginas anteriores do histórico — usado pela rolagem infinita pra cima. */
  @Get(':id/messages')
  listMessages(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.listMessages(id, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/messages/:messageId/reaction')
  react(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body('emoji') emoji: string,
  ) {
    return this.conversationsService.reactToMessage(id, messageId, emoji ?? '');
  }

  /**
   * O botão de transcrever, do lado do atendente.
   *
   * Exige a mesma permissão de responder porque é quem responde que
   * precisa entender o áudio — e porque cada chamada destas custa dinheiro
   * do dono da conta.
   */
  @Post(':id/messages/:messageId/transcrever')
  @RequiresPermission('conversations.send')
  transcrever(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.transcricao.transcreverAPedido(id, messageId);
  }

  /**
   * Apaga do painel. Não apaga do telefone do cliente — a Cloud API não
   * tem esse recurso, e a tela avisa isso antes de confirmar.
   */
  @Delete(':id/messages/:messageId')
  @RequiresPermission('conversations.send')
  apagarMensagem(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.apagarMensagem(id, messageId, {
      userId: user.userId,
      role: user.role,
      // O nome vai junto pra o registro dizer QUEM apagou sem depender de
      // o usuário ainda existir quando alguém for ler.
      name: user.name,
    });
  }

  @Post(':id/messages/:messageId/forward')
  @RequiresPermission('conversations.send')
  forward(
    @Param('messageId') messageId: string,
    @Body('toConversationId') toConversationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.forwardMessage(
      messageId,
      toConversationId,
      user.userId,
    );
  }

  @Post(':id/messages')
  @RequiresPermission('conversations.send')
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.sendAgentMessage(
      id,
      user.userId,
      dto.content,
      dto.replyToId,
    );
  }

  /**
   * `force` é a confirmação de quem já viu o aviso de que a conversa tem
   * outro dono. Sem ele o serviço responde 409 com o nome de quem está
   * atendendo, e a tela transforma isso na pergunta.
   */
  @Post(':id/assign')
  @RequiresPermission('conversations.assign')
  async assign(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body('force') force?: boolean,
  ) {
    const conversa = await this.conversationsService.assign(id, user.userId, {
      role: user.role,
      force: Boolean(force),
    });
    await this.registrar(
      user,
      'CONVERSA_ATRIBUIDA',
      id,
      `Assumiu a conversa com ${this.nomeDoCliente(conversa)}.`,
    );
    return conversa;
  }

  @Post(':id/transfer')
  @RequiresPermission('conversations.assign')
  async transfer(
    @Param('id') id: string,
    @Body('toUserId') toUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const conversa = await this.conversationsService.transferTo(
      id,
      toUserId,
      user.userId,
    );
    await this.registrar(
      user,
      'CONVERSA_TRANSFERIDA',
      id,
      `Transferiu a conversa com ${this.nomeDoCliente(conversa)} para ${conversa.assignedUser?.name ?? 'outro atendente'}.`,
    );
    return conversa;
  }

  /** Encaminha pro setor, sem nomear pessoa — quem estiver livre pega. */
  @Post(':id/transfer-queue')
  @RequiresPermission('conversations.assign')
  transferQueue(
    @Param('id') id: string,
    @Body('queueId') queueId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.transferToQueue(id, queueId, user.userId);
  }

  /**
   * Etiquetar é parte de atender, então segue a permissão de responder.
   *
   * A etiqueta não fala com o cliente nem muda o estado do atendimento: ela
   * organiza o que quem atende já está fazendo. Exigir uma permissão
   * própria pra isso significaria que a pessoa certa pra classificar a
   * conversa é justamente a que não está com ela na mão.
   */
  @Post(':id/tags/:tagId')
  @RequiresPermission('conversations.send')
  marcar(@Param('id') id: string, @Param('tagId') tagId: string) {
    return this.conversationsService.marcarEtiqueta(id, tagId);
  }

  @Delete(':id/tags/:tagId')
  @RequiresPermission('conversations.send')
  desmarcar(@Param('id') id: string, @Param('tagId') tagId: string) {
    return this.conversationsService.desmarcarEtiqueta(id, tagId);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.acceptAssignment(id, user.userId);
  }

  @Post(':id/decline')
  decline(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.declineAssignment(id, user.userId, reason);
  }

  /**
   * "O fim da conversa está na minha tela." Chamada pela tela quando o
   * rodapé da conversa entra na área visível — abrir a conversa, sozinho,
   * não marca mais nada como lido.
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id') id: string) {
    return this.conversationsService.marcarComoLida(id);
  }

  @Post(':id/reopen')
  @RequiresPermission('conversations.resolve')
  async reopen(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const conversa = await this.conversationsService.reopen(id);
    await this.registrar(
      user,
      'CONVERSA_REABERTA',
      id,
      `Reabriu o atendimento de ${this.nomeDoCliente(conversa)}.`,
    );
    return conversa;
  }

  @Post(':id/resolve')
  @RequiresPermission('conversations.resolve')
  async resolve(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const conversa = await this.conversationsService.resolve(id);
    await this.registrar(
      user,
      'CONVERSA_RESOLVIDA',
      id,
      `Encerrou o atendimento de ${this.nomeDoCliente(conversa)}.`,
    );
    return conversa;
  }

  /**
   * Limite de 16 MB porque é o teto da própria Cloud API pra vídeo/áudio
   * (documento vai até 100 MB, mas manter um número só evita prometer o
   * que a Meta recusaria depois do upload).
   */
  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }),
  )
  @RequiresPermission('conversations.attachments')
  sendAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
    @Body('caption') caption?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    return this.conversationsService.sendAttachment(
      id,
      user.userId,
      file,
      caption,
    );
  }

  @Post(':id/priority')
  @RequiresPermission('conversations.priority')
  setPriority(@Param('id') id: string, @Body() dto: SetPriorityDto) {
    return this.conversationsService.setPriority(id, dto.priority);
  }

  @Post(':id/reactivate-ai')
  reactivateAi(@Param('id') id: string) {
    return this.conversationsService.setAiMode(id, 'AI_ACTIVE');
  }

  /** Ferramenta de teste: simula uma mensagem chegando de um cliente, sem precisar de um WhatsApp real. */
  @Post('simulate-inbound')
  @Roles('OWNER', 'ADMIN')
  simulateInbound(@Body() dto: SimulateInboundDto) {
    return this.conversationsService.receiveInbound(dto);
  }
}
