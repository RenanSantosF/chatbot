import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** Onde conheceu a plataforma (ver ORIGENS no painel da plataforma). Opcional. */
  @IsOptional()
  @IsIn(['instagram', 'indicacao', 'google', 'youtube', 'tiktok', 'facebook', 'whatsapp', 'outro'])
  comoConheceu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  comoConheceuDetalhe?: string;

  /** Os utm_* com que a pessoa chegou na landing, guardados no navegador. */
  @IsOptional()
  @IsObject()
  utm?: Record<string, string>;

  /** O visitante anônimo da landing — liga o funil de antes ao de depois. */
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  visitante?: string;
}
