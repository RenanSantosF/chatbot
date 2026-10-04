import type {
  MessageStatus,
  Prisma,
} from '../../../../../generated/prisma/client';
import type { MensagemDoHistorico } from '../../../conversations/historico-guardado';
import { empacotarId, telefoneDoJid } from './evolution-id';
import {
  chaveDoEvento,
  horaDaMensagem,
  reacaoDaMensagem,
  traduzirMensagem,
  traduzirStatus,
  type DadosDaMensagem,
} from './evolution-mensagem';

/**
 * Uma mensagem que a Evolution guardou, no formato das linhas do histórico.
 *
 * Serve aos dois caminhos que trazem mensagem "de fora do tempo real": o
 * lote de conversas antigas que o aparelho manda ao parear, e a
 * recuperação do que se perdeu numa conversa (ver
 * `ConversationsService.recuperarDoWhatsapp`). O formato é o mesmo do
 * webhook, e a tradução precisa ser uma só — duas cópias divergiriam na
 * primeira mudança de formato.
 *
 * `null` pro que não é conversa individual (grupo, transmissão, status),
 * pro tipo que não sabemos mostrar e pra mensagem sem hora: sem hora, uma
 * conversa de meses atrás entraria carimbada de hoje.
 */
const ORDEM_DO_STATUS: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

/**
 * Até onde a mensagem chegou: entregue, lida.
 *
 * A Evolution guarda o status da mensagem e cada atualização dele em
 * `MessageUpdate`. Sem ler isto, a mensagem recuperada aparecia com um
 * tique só, mesmo já lida pelo cliente — os avisos de entrega e leitura
 * chegaram antes de ela existir no painel e não acharam onde se aplicar.
 */
function statusGuardado(dados: DadosDaMensagem): MessageStatus | null {
  const bruto = dados as DadosDaMensagem & {
    MessageUpdate?: { status?: string | number }[];
  };
  const todos = [
    dados.status,
    ...(Array.isArray(bruto.MessageUpdate)
      ? bruto.MessageUpdate.map((u) => u?.status)
      : []),
  ]
    .map((s) => traduzirStatus(s))
    .filter((s): s is MessageStatus => s !== null && s !== 'FAILED');
  if (todos.length === 0) return null;
  return todos.reduce((maior, s) =>
    ORDEM_DO_STATUS[s] > ORDEM_DO_STATUS[maior] ? s : maior,
  );
}

export function mensagemGuardada(dados: DadosDaMensagem): {
  telefone: string;
  nome?: string;
  mensagem: MensagemDoHistorico;
  /** Até onde chegou, quando o servidor sabe (ver `statusGuardado`). */
  status: MessageStatus | null;
} | null {
  const chave = chaveDoEvento(dados);
  if (!chave) return null;

  const telefone = telefoneDoJid(chave.remoteJid);
  if (!telefone) return null;

  // Reação não é linha da conversa: ela muda a mensagem reagida.
  if (reacaoDaMensagem(dados)) return null;

  const traduzida = traduzirMensagem(dados);
  if (!traduzida) return null;

  const createdAt = horaDaMensagem(dados);
  if (!createdAt) return null;

  const externalId = empacotarId(chave);
  const metadata = traduzida.metadata
    ? {
        ...traduzida.metadata,
        // O anexo antigo NÃO é arquivado aqui: seriam milhares de
        // downloads numa importação, e o WhatsApp já não devolve o
        // binário de mensagem velha na maior parte das vezes. O handle
        // fica gravado e a busca acontece sob demanda, se alguém abrir
        // aquele balão (ou o arquivamento em segundo plano chegar nele).
        evolutionPendente: undefined,
        ...(traduzida.metadata.evolutionPendente
          ? { mediaId: externalId }
          : {}),
      }
    : undefined;

  return {
    telefone,
    // O nome sai só das mensagens do CLIENTE: nas que a empresa mandou,
    // o nome de exibição é o dela (o WhatsApp costuma entregar "Você").
    nome: !chave.fromMe ? dados.pushName : undefined,
    status: statusGuardado(dados),
    mensagem: {
      daEmpresa: Boolean(chave.fromMe),
      content: traduzida.content,
      messageType: traduzida.messageType,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      externalId,
      createdAt,
    },
  };
}
