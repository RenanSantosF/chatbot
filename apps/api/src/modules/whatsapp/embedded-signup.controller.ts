import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { EmbeddedSignupService } from './embedded-signup.service';

export class ConcluirEmbeddedSignupDto {
  /** Código devolvido pela janela da Meta. Vale 30 segundos. */
  @IsString()
  @MinLength(10)
  code!: string;

  @IsString()
  @MinLength(3)
  wabaId!: string;

  @IsString()
  @MinLength(3)
  phoneNumberId!: string;

  @IsOptional()
  @IsString()
  businessId?: string;
}

@Controller('whatsapp/embedded-signup')
export class EmbeddedSignupController {
  constructor(private readonly embeddedSignup: EmbeddedSignupService) {}

  /**
   * Identificadores públicos pra tela abrir a janela da Meta. Sem
   * @RequiresPermission: não há segredo aqui, e a tela precisa saber se o
   * botão deve existir antes de saber quem clicou.
   */
  @Get('config')
  config() {
    return this.embeddedSignup.configuracaoPublica();
  }

  @Post()
  @RequiresPermission('whatsapp.manage')
  concluir(@Body() dto: ConcluirEmbeddedSignupDto) {
    return this.embeddedSignup.concluir(dto);
  }
}
