import { Body, Controller, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import type { RequestUser } from '../auth/auth.types';
import { CorrecaoDeTextoService } from './correcao-de-texto.service';

class CorrigirTextoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  texto!: string;
}

@Controller('ai')
export class CorrecaoDeTextoController {
  constructor(private readonly correcao: CorrecaoDeTextoService) {}

  /** Corrige o texto que o atendente vai mandar — o botão ✨ do compositor. */
  @Post('corrigir-texto')
  @RequiresPermission('conversations.send')
  corrigir(@Body() dto: CorrigirTextoDto, @CurrentUser() user: RequestUser) {
    return this.correcao.corrigir(dto.texto, user.userId);
  }
}
