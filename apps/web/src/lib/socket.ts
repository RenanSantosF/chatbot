"use client";

import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

/**
 * Conecta direto na origem da API (não passa pelo rewrite do Next — upgrade
 * de WebSocket não é confiável através dele). Por isso a autenticação não
 * usa o cookie httpOnly de sessão: o token vem explicitamente via
 * GET /auth/socket-token e é passado no handshake.
 */
export function connectRealtime(token: string): Socket {
  return io(`${SOCKET_URL}/realtime`, {
    auth: { token },
    transports: ["websocket"],
  });
}
