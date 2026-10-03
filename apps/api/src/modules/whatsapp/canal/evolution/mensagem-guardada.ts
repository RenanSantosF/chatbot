import type { Prisma } from '../../../../../generated/prisma/client';
import type { MensagemDoHistorico } from '../../../conversations/historico-guardado';
import { empacotarId, telefoneDoJid } from './evolution-id';
import {
  chaveDoEvento,
  horaDaMensagem,
  reacaoDaMensagem,
  traduzirMensagem,
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
export function mensagemGuardada(
  dados: DadosDaMensagem,
): { telefone: string; nome?: string; mensagem: MensagemDoHistorico } | null {
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
