import { IsString, MinLength } from 'class-validator';

export class SimulateDto {
  @IsString()
  @MinLength(1)
  message!: string;
}
