import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateQuickReplyDto {
  /**
   * O que se digita depois da barra. Chega como a pessoa escreveu e é
   * normalizado no serviço — quem cadastra pensa em "Bom dia", quem usa
   * digita "/bomdia".
   */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  shortcut!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  /**
   * O teto é o mesmo de uma mensagem de WhatsApp. Resposta rápida que não
   * cabe numa mensagem não é resposta rápida.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content!: string;
}

export class UpdateQuickReplyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  shortcut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content?: string;
}
