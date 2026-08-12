import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsArray, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { CopilotService } from './copilot.service';

class CopilotTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

class AskDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotTurnDto)
  history!: CopilotTurnDto[];
}

@Controller('copilot')
@UseGuards(AuthGuard('jwt'))
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  ask(@Body() dto: AskDto) {
    return this.copilot.ask(dto.history);
  }
}
