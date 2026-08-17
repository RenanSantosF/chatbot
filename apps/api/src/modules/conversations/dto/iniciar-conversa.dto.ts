import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Puxar conversa com um número, escrevendo a mensagem.
 *
 * Não tem template nem parâmetro: no canal por aparelho vinculado, falar
 * primeiro é mandar uma mensagem comum. O telefone chega como a pessoa
 * digitou — com parênteses, traço, espaço — e é limpo no serviço, porque
 * exigir formato aqui só transformaria um acerto trivial numa mensagem de
 * erro.
 */
export class IniciarConversaDto {
  @IsString()
  @MinLength(10)
  @MaxLength(30)
  phone!: string;

  /** Quando o número ainda não é cliente, é assim que ele ganha nome. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
