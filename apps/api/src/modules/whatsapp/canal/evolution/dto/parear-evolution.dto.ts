import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * O número do aparelho que vai atender, quando o pareamento é por código.
 *
 * Diferente do endereço e da chave do servidor — que saíram desta tela
 * porque são infraestrutura nossa —, o telefone É informação de quem usa:
 * é o número da empresa dele. Por isso ele volta a existir aqui, e só ele.
 *
 * A validação é rígida de propósito. Um número sem DDI, ou com nove
 * dígitos a mais por engano, produz um código de pareamento que o
 * WhatsApp aceita gerar e nunca reconhece: a pessoa digita no celular, não
 * acontece nada, e não há erro em lugar nenhum pra explicar. Recusar aqui,
 * com a regra escrita, é a única forma de esse engano ter resposta.
 */
export class PearEvolutionDto {
  /**
   * Só dígitos, com DDI. Ausente = pareamento por QR code.
   *
   * O intervalo de 10 a 15 é o do padrão E.164 com folga pra baixo:
   * abaixo de 10 não existe número com DDI, e 15 é o teto da norma.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, {
    message:
      'Informe o número com DDI e DDD, só dígitos (ex.: 5527999998888).',
  })
  numero?: string;
}
