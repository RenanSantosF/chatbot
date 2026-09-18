import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OnGatewayConnection } from '@nestjs/websockets';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/auth.types';

function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Canal de tempo real do painel: novas mensagens e mudanças de conversa
 * chegam aqui em vez do frontend precisar dar polling. Autenticação é feita
 * manualmente no handshake (não passa pelos guards HTTP do Nest) usando o
 * mesmo JWT emitido no login — ver GET /auth/socket-token.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.WEB_APP_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      void client.join(tenantRoom(payload.tenantId));
      // A sala por pessoa é o que permite mandar um evento de UMA conversa
      // só pra quem pode vê-la (ver `emitToUsers`), sem depender de sala de
      // setor — que ficaria velha assim que alguém mudasse de fila, fosse
      // atribuído ou a conversa fosse transferida no meio da sessão.
      void client.join(userRoom(payload.sub));
    } catch {
      this.logger.warn('Conexão websocket rejeitada: token inválido.');
      client.disconnect(true);
    }
  }

  /** Pra evento que não é de UMA conversa — ex: o estado da conexão do WhatsApp. */
  emitToTenant(tenantId: string, event: string, payload: unknown) {
    this.server.to(tenantRoom(tenantId)).emit(event, payload);
  }

  /**
   * Pra evento de uma conversa específica: só quem tem acesso a ela recebe.
   *
   * Quem calcula a lista é quem conhece o recorte de visibilidade —
   * `ConversationsService` — porque é o mesmo cálculo que já decide quem vê
   * a conversa na lista e ao abrir pelo id. Aqui só se entrega.
   */
  emitToUsers(userIds: string[], event: string, payload: unknown) {
    if (userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit(event, payload);
  }
}
