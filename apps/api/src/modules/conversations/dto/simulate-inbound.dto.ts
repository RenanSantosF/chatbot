import { IsString, MinLength } from 'class-validator';

/**
 * Simula uma mensagem chegando de um cliente por um canal externo. Fica no
 * lugar do webhook real do WhatsApp até a Fase 7 — mesma lógica de negócio
 * (ConversationsService.receiveInbound), só troca a porta de entrada.
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
