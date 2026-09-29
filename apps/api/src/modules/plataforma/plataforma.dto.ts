import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { EVENTOS_DO_NAVEGADOR } from './registro-de-eventos.service';

/** Um passo anônimo, mandado pela landing ou pela tela de cadastro. */
export class EventoDoNavegadorDto {
  @IsIn(EVENTOS_DO_NAVEGADOR)
  tipo!: string;

  /** Id gerado no navegador — só letras, números e hífen, pra não virar lixo no banco. */
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  visitante!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  caminho?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;

  @IsOptional()
  @IsObject()
  utm?: Record<string, string>;
}

/** Erro da tela, mandado pelo navegador. */
export class ErroDoNavegadorDto {
  @IsString()
  @MaxLength(500)
  mensagem!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pilha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  rota?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  status?: number;
}
