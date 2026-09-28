import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LIMITE_DAS_INSTRUCOES_GERAIS } from '../ai-context';

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
   * Chegou a 8000, e desceu pra 3000: este texto vai inteiro em TODA
   * resposta da IA, então cada caractere daqui é pago milhares de vezes
   * por mês. Script longo, tabela e política vão como documento na base de
   * conhecimento, de onde só sai o trecho que responde a pergunta. A tela
   * mostra um contador ao vivo, e a mensagem de erro diz pra onde levar o
   * excesso.
   */
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_DAS_INSTRUCOES_GERAIS, {
    message: `As instruções gerais podem ter no máximo ${LIMITE_DAS_INSTRUCOES_GERAIS} caracteres. Pra um texto maior, suba como documento na base de conhecimento.`,
  })
  customInstructions?: string;

  /** O que a IA pode guardar do cliente entre uma conversa e outra. */
  @IsOptional()
  @IsEnum(AiMemoryModeDto)
  memoryMode?: AiMemoryModeDto;
}
