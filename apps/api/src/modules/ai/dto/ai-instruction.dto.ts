import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LIMITE_POR_REGRA } from '../ai-context';

/**
 * Uma regra é uma regra: "nunca dê desconto acima de 10%", "pergunte o
 * número do pedido antes de tudo". Cabe em poucas linhas.
 *
 * Foi de 4000 pra 1000 porque as regras vão inteiras em TODA resposta da
 * IA (ver ORCAMENTO_DAS_REGRAS). Texto longo — tabela de preços, script,
 * política — é conteúdo de consulta, e vai como documento na base de
 * conhecimento, de onde só sai o trecho que responde a pergunta.
 */
const LIMITE_DO_CONTEUDO = LIMITE_POR_REGRA;

export class CreateAiInstructionDto {
  @IsString()
  @MinLength(2, { message: 'Escreva um assunto pra regra.' })
  @MaxLength(120, { message: 'O assunto pode ter no máximo 120 caracteres.' })
  title!: string;

  @IsString()
  @MinLength(2, { message: 'Escreva o que a IA deve saber ou fazer.' })
  @MaxLength(LIMITE_DO_CONTEUDO, {
    message: `Esta regra pode ter no máximo ${LIMITE_DO_CONTEUDO} caracteres. Pra um texto maior, suba como documento na base de conhecimento.`,
  })
  content!: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdateAiInstructionDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Escreva um assunto pra regra.' })
  @MaxLength(120, { message: 'O assunto pode ter no máximo 120 caracteres.' })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Escreva o que a IA deve saber ou fazer.' })
  @MaxLength(LIMITE_DO_CONTEUDO, {
    message: `Esta regra pode ter no máximo ${LIMITE_DO_CONTEUDO} caracteres. Pra um texto maior, suba como documento na base de conhecimento.`,
  })
  content?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
