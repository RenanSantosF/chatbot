import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateInboxSettingsDto {
  @IsOptional()
  @IsBoolean()
  sendReadReceipts?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnResolve?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  resolveMessage?: string;
}
