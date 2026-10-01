import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class PedirRedefinicaoDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(200)
  email!: string;
}

export class ConferirRedefinicaoDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}

export class RedefinirSenhaDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  /** A mesma regra do cadastro. */
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(72)
  senha!: string;
}
