import { IsString, MinLength } from 'class-validator';

export class ExcluirContaDto {
  /**
   * A senha de quem está pedindo.
   *
   * Uma sessão esquecida aberta numa máquina não pode apagar a empresa
   * inteira. É a mesma exigência da troca de senha, pelo mesmo motivo, com
   * uma consequência bem maior.
   */
  @IsString()
  @MinLength(1)
  password!: string;

  /**
   * O nome da empresa, digitado à mão.
   *
   * Não é burocracia: é o que separa "cliquei sem ler" de "eu quis fazer
   * isto". Uma caixa de confirmação com um botão vermelho é clicada no
   * automático; digitar o nome exige ler o que está escrito nele.
   */
  @IsString()
  @MinLength(1)
  confirmacao!: string;
}
