import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateAiToolDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['ALLOW', 'DENY', 'REQUIRES_APPROVAL'])
  permission?: 'ALLOW' | 'DENY' | 'REQUIRES_APPROVAL';
}
