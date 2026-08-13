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
} from 'class-validator';

export class UpdateInboxSettingsDto {
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
  showAgentName?: boolean;

  @IsOptional()
  @IsIn(['ALL', 'OWN_QUEUES'])
  queueVisibility?: 'ALL' | 'OWN_QUEUES';
}
