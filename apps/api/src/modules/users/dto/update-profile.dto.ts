import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * O que qualquer usuário pode mudar na própria conta — de propósito não tem
 * `role` nem `status` aqui: permissão é decisão do dono (ver UpdateUserDto),
 * nunca de quem está sendo permissionado.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** Só exigida quando está trocando a senha — confirma que é mesmo o dono da sessão. */
  @ValidateIf((dto: UpdateProfileDto) => dto.newPassword !== undefined)
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword?: string;
}
