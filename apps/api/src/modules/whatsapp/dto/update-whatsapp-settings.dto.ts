import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateWhatsAppSettingsDto {
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  phoneNumberId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayPhoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  wabaId?: string;

  /** Novo token pra salvar (criptografado). Omitir mantém o token atual. */
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  accessToken?: string;

  /** Novo app secret pra salvar (criptografado). Omitir mantém o atual. */
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  appSecret?: string;
}
