import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Era 2000 caracteres. Uma regra bem escrita cabe fácil nisso — mas quem
 * cola um script de atendimento inteiro numa regra só (em vez de usar
 * "Instruções gerais", pensado pra isso) esbarrava no limite sem aviso
 * nenhum na tela, só ao tentar salvar, e a mensagem era o texto cru do
 * class-validator em inglês. Dobrado pra 4000 dá folga real, e a tela
 * agora mostra um contador ao vivo — a segunda parte do que resolve a
 * reclamação, porque um limite maior sem contador só adia a mesma surpresa.
 */
const LIMITE_DO_CONTEUDO = 4000;

export class CreateAiInstructionDto {
  @IsString()
  @MinLength(2, { message: 'Escreva um assunto pra regra.' })
  @MaxLength(120, { message: 'O assunto pode ter no máximo 120 caracteres.' })
  title!: string;

  @IsString()
  @MinLength(2, { message: 'Escreva o que a IA deve saber ou fazer.' })
  @MaxLength(LIMITE_DO_CONTEUDO, {
    message: `Esta regra pode ter no máximo ${LIMITE_DO_CONTEUDO} caracteres. Pra um texto maior, use "Instruções gerais" em Configurações > IA.`,
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
    message: `Esta regra pode ter no máximo ${LIMITE_DO_CONTEUDO} caracteres. Pra um texto maior, use "Instruções gerais" em Configurações > IA.`,
  })
  content?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
