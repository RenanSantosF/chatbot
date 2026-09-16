import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum AiToneDto {
  PROFESSIONAL = 'PROFESSIONAL',
  FRIENDLY = 'FRIENDLY',
  CASUAL = 'CASUAL',
  OBJECTIVE = 'OBJECTIVE',
  WARM = 'WARM',
}

export enum AiMemoryModeDto {
  NONE = 'NONE',
  IMPORTANT_ONLY = 'IMPORTANT_ONLY',
  FULL = 'FULL',
}

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Dê um nome pra IA.' })
  @MaxLength(60, { message: 'O nome pode ter no máximo 60 caracteres.' })
  aiName?: string;

  @IsOptional()
  @IsEnum(AiToneDto)
  tone?: AiToneDto;

  /**
   * O "treinamento geral" — a personalidade e as regras que valem sempre.
   *
   * Era 4000 (~1000 tokens). Dobrado pra 8000 depois de um cliente relatar
   * que um script de atendimento real, colado inteiro aqui, esbarrava no
   * limite — e a mensagem que ele via era a do class-validator em inglês
   * ("customInstructions must be shorter..."), sem dizer quantos caracteres
   * sobravam nem por quê. As duas coisas mudam juntas: o limite sobe, e a
   * mensagem passa a ser em português (ver a tela, que também mostra um
   * contador ao vivo pra isso nunca mais ser descoberto só ao tentar salvar).
   */
  @IsOptional()
  @IsString()
  @MaxLength(8000, {
    message: 'As instruções gerais podem ter no máximo 8000 caracteres.',
  })
  customInstructions?: string;

  /** O que a IA pode guardar do cliente entre uma conversa e outra. */
  @IsOptional()
  @IsEnum(AiMemoryModeDto)
  memoryMode?: AiMemoryModeDto;
}
