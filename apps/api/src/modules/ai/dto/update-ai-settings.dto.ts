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

  /** Chave nova pra salvar (criptografada). Omitir mantém a chave atual. */
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  apiKey?: string;

  /**
   * Nome do modelo (ex: "gemini-2.5-flash"). Sem isso, usa o padrão do
   * código — que o Google pode descontinuar a qualquer momento. Expor esse
   * campo evita depender de deploy toda vez que isso acontecer.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
