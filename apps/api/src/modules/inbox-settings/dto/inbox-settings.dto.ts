import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { lerHorario } from '../horario-comercial';

/**
 * Confere a forma do expediente antes de ele virar uma coluna Json.
 *
 * A normalização (`lerExpediente`) descarta faixa inválida em silêncio, o
 * que é o certo na LEITURA — dado velho e torto não pode derrubar a
 * resposta ao cliente. Na ESCRITA silêncio é ruim: quem digitou o horário
 * errado salvaria a tela, veria o campo esvaziar e não saberia por quê.
 */
@ValidatorConstraint({ name: 'expedienteValido' })
export class ExpedienteValido implements ValidatorConstraintInterface {
  private erro = 'Horário de atendimento inválido.';

  validate(valor: unknown): boolean {
    if (valor === null) return true;
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
      this.erro = 'O horário de atendimento precisa ser um objeto por dia.';
      return false;
    }

    for (const [dia, faixas] of Object.entries(
      valor as Record<string, unknown>,
    )) {
      const numero = Number(dia);
      if (!Number.isInteger(numero) || numero < 0 || numero > 6) {
        this.erro = `"${dia}" não é um dia da semana (use 0 a 6, domingo é 0).`;
        return false;
      }
      if (!Array.isArray(faixas)) {
        this.erro = `As faixas de ${dia} precisam ser uma lista.`;
        return false;
      }
      for (const faixa of faixas) {
        const inicio = Array.isArray(faixa) ? lerHorario(faixa[0]) : null;
        const fim = Array.isArray(faixa) ? lerHorario(faixa[1]) : null;
        if (inicio === null || fim === null) {
          this.erro = 'Cada faixa precisa ser [abertura, fechamento] no formato HH:MM.';
          return false;
        }
        if (fim <= inicio) {
          this.erro = 'O fechamento precisa vir depois da abertura.';
          return false;
        }
      }
    }

    return true;
  }

  defaultMessage(): string {
    return this.erro;
  }
}

export class UpdateInboxSettingsDto {
  /**
   * A primeira resposta automática, sem IA no meio.
   *
   * Sai uma vez, na abertura da conversa, e só quando a IA não vai
   * responder. Depois dela a conversa fica na fila esperando gente.
   */
  @IsOptional()
  @IsBoolean()
  greetingEnabled?: boolean;

  /**
   * O texto é curto de propósito no limite de baixo: uma saudação com
   * menos de cinco caracteres não diz nada a quem recebe, e vale mais
   * recusar que mandar "ok" em nome da empresa.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  greetingMessage?: string;

  @IsOptional()
  @IsBoolean()
  sendReadReceipts?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnResolve?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  resolveMessage?: string;

  /**
   * Deixa responder numa conversa encerrada, reabrindo o atendimento em vez
   * de travar o compositor. Ligado por padrão: o cliente do outro lado não
   * vê "encerrado", vê uma conversa de WhatsApp.
   */
  @IsOptional()
  @IsBoolean()
  allowSendWhenResolved?: boolean;

  @IsOptional()
  @IsBoolean()
  groupByCustomer?: boolean;

  /** De 1 hora a 30 dias. Fora disso não é agrupamento, é outra coisa. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  groupWindowHours?: number;

  @IsOptional()
  @IsBoolean()
  autoCloseIdle?: boolean;

  /**
   * O teto é 23 e não 24 de propósito: o ponto do recurso é encerrar ANTES
   * da janela de atendimento do WhatsApp expirar. Deixar marcar 24 seria
   * oferecer um ajuste que não cumpre o que promete.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(23)
  autoCloseHours?: number;

  @IsOptional()
  @IsBoolean()
  autoCloseNotify?: boolean;

  /**
   * O mesmo teto da mensagem de encerramento manual. Despedida que não cabe
   * numa mensagem de WhatsApp não é despedida.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  autoCloseMessage?: string;

  @IsOptional()
  @IsBoolean()
  showAgentName?: boolean;

  @IsOptional()
  @IsIn(['ALL', 'OWN_QUEUES'])
  queueVisibility?: 'ALL' | 'OWN_QUEUES';

  /**
   * O que acontece com o áudio do cliente quando quem responde é gente.
   *
   * Não vale pro atendimento da IA: ela transcreve sempre, porque sem isso
   * não tem o que responder. Aqui a escolha é de custo — cada transcrição
   * é uma chamada ao modelo, paga pelo dono da conta:
   *
   * - DESLIGADA: nem o botão aparece.
   * - SOB_DEMANDA: o atendente clica quando quiser (padrão).
   * - AUTOMATICA: todo áudio recebido já chega transcrito.
   */
  @IsOptional()
  @IsIn(['DESLIGADA', 'SOB_DEMANDA', 'AUTOMATICA'])
  transcricaoDeAudio?: 'DESLIGADA' | 'SOB_DEMANDA' | 'AUTOMATICA';

  /**
   * As faixas de atendimento de cada dia, domingo em 0.
   *
   * `null` desliga o recurso: sem expediente configurado, a empresa atende
   * em qualquer horário. É o mesmo estado de quem nunca abriu a tela, e por
   * isso não existe um booleano separado pra ligar e desligar.
   */
  @IsOptional()
  @Validate(ExpedienteValido)
  businessHours?: Record<string, [string, string][]> | null;
}
