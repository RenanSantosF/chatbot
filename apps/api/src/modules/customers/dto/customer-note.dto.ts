import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCustomerNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  /** Pendência aparece em destaque até alguém marcar como resolvida. */
  @IsOptional()
  @IsBoolean()
  isPending?: boolean;

  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;
}

export class UpdateCustomerNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isPending?: boolean;

  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;

  /** true resolve a pendência (carimba a data), false reabre. */
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}
