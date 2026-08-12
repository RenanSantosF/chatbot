import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum RulePriorityDto {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreateRoutingRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /**
   * Descrição do assunto em português — é literalmente o texto que a IA lê
   * pra decidir se a conversa é desta regra, então quanto mais concreto
   * ("cobrança, boleto, segunda via"), melhor a escolha dela.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  subject!: string;

  @IsOptional()
  @IsEnum(RulePriorityDto)
  minPriority?: RulePriorityDto;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsOptional()
  @IsUUID()
  targetQueueId?: string;
}

export class UpdateRoutingRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  subject?: string;

  @IsOptional()
  @IsEnum(RulePriorityDto)
  minPriority?: RulePriorityDto;

  /** null limpa o destino; undefined mantém o que já estava. */
  @IsOptional()
  @IsUUID()
  targetUserId?: string | null;

  @IsOptional()
  @IsUUID()
  targetQueueId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  priorityOrder?: number;
}
