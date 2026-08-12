"use client";

import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

/**
 * Conecta direto na origem da API (não passa pelo rewrite do Next — upgrade
 * de WebSocket não é confiável através dele). Por isso a autenticação não
 * usa o cookie httpOnly de sessão: o token vem explicitamente via
 * GET /auth/socket-token e é passado no handshake.
 *
 * `getToken` é chamado de novo a cada tentativa de (re)conexão — não só na
 * primeira — porque o token do socket dura só 1h; sem isso, a aba fica
 * aberta o dia todo, a rede cai uma vez, e a reconexão automática do
 * Socket.io fica tentando pra sempre com um token expirado.
 */
export function connectRealtime(getToken: () => Promise<string>): Socket {
  return io(`${SOCKET_URL}/realtime`, {
    auth: (cb) => {
      getToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: '' }));
    },
    transports: ["websocket"],
  });
}
