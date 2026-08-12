import { IsString, MinLength } from 'class-validator';

/**
 * Simula uma mensagem chegando de um cliente por um canal externo, sem
 * precisar de um número de WhatsApp real — mesma lógica de negócio do
 * webhook (ConversationsService.receiveInbound), só troca a porta de
 * entrada. Útil pra testar o Inbox e o comportamento da IA rapidamente.
 */
export class SimulateInboundDto {
  @IsString()
  @MinLength(8)
  customerPhone!: string;

  @IsString()
  @MinLength(1)
  customerName!: string;

  @IsString()
  @MinLength(1)
  content!: string;
}
