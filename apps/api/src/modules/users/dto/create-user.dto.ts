import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/** Nunca aceita 'OWNER' aqui — só existe um dono, o que registrou a empresa. */
export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  @IsIn(['ADMIN', 'AGENT'])
  role!: 'ADMIN' | 'AGENT';
}
