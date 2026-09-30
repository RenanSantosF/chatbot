import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.types';
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
  // Só as últimas 12 vão pro modelo (ver CopilotService.ask); o teto aqui
  // impede alguém de mandar um histórico gigante pra ser validado à toa.
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CopilotTurnDto)
  history!: CopilotTurnDto[];
}

class ConfirmarDto {
  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  token!: string;
}

@Controller('copilot')
@UseGuards(AuthGuard('jwt'))
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  ask(@Body() dto: AskDto, @CurrentUser() user: RequestUser) {
    // O papel decide quais ferramentas o assistente pode usar por ela, e a
    // pessoa decide quais conversas ele pode ler (o recorte de setor).
    return this.copilot.ask(dto.history, user);
  }

  /** O clique em "Confirmar" numa proposta do assistente. */
  @Post('confirmar')
  confirmar(@Body() dto: ConfirmarDto, @CurrentUser() user: RequestUser) {
    return this.copilot.confirmar(dto.token, user);
  }

  /** O que pede atenção agora — o pontinho no botão do assistente. */
  @Get('avisos')
  avisos(@CurrentUser() user: RequestUser) {
    return this.copilot.avisos(user);
  }
}
