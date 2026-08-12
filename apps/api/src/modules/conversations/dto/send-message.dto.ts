import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content!: string;

  /** Id da mensagem sendo citada, quando é uma resposta. */
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}
