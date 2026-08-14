import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CORES } from '../tags.service';

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  /** Só a paleta conferida nos dois temas do painel (ver CORES). */
  @IsOptional()
  @IsIn(CORES)
  color?: string;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsIn(CORES)
  color?: string;
}
