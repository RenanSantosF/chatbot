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
  @MinLength(1)
  @MaxLength(60)
  aiName?: string;

  @IsOptional()
  @IsEnum(AiToneDto)
  tone?: AiToneDto;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customInstructions?: string;

  /** O que a IA pode guardar do cliente entre uma conversa e outra. */
  @IsOptional()
  @IsEnum(AiMemoryModeDto)
  memoryMode?: AiMemoryModeDto;
}
