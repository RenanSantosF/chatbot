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

  /** Chave nova pra salvar (criptografada). Omitir mantém a chave atual. */
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  apiKey?: string;

  /**
   * Nome do modelo (ex: "gemini-3.1-flash-lite"). Sem isso, usa o padrão
   * do código — que o Google pode descontinuar a qualquer momento. Expor
   * esse campo evita depender de deploy toda vez que isso acontecer.
   *
   * Continua string livre, e de propósito: a tela oferece um seletor com o
   * que a chave da empresa alcança (ver AiSettingsService.listarModelos),
   * mas travar o formato AQUI faria um modelo novo do Google precisar de
   * deploy pra poder ser usado — que é exatamente o que este campo existe
   * pra evitar.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  /** O que a IA pode guardar do cliente entre uma conversa e outra. */
  @IsOptional()
  @IsEnum(AiMemoryModeDto)
  memoryMode?: AiMemoryModeDto;
}
