import { IsString, MaxLength, MinLength } from 'class-validator';

/** O texto novo de uma mensagem já enviada. */
export class EditarMensagemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  texto!: string;
}
