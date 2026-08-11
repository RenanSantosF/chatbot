import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OnGatewayConnection } from '@nestjs/websockets';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/auth.types';

function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
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
    } catch {
      this.logger.warn('Conexão websocket rejeitada: token inválido.');
      client.disconnect(true);
    }
  }

  emitToTenant(tenantId: string, event: string, payload: unknown) {
    this.server.to(tenantRoom(tenantId)).emit(event, payload);
  }
}
