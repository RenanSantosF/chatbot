import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { BillingExempt } from '../../common/billing/billing-exempt.decorator';
import { ErroDoNavegadorDto, EventoDoNavegadorDto } from './plataforma.dto';
import { PlataformaGuard } from './plataforma.guard';
import { PlataformaService } from './plataforma.service';
import { RegistroDeErros } from './registro-de-erros.service';
import {
  RegistroDeEventos,
  dia,
  utmLimpo,
  type TipoDeEvento,
} from './registro-de-eventos.service';

/** Só o domínio de onde a pessoa veio — o caminho pode ter dado pessoal. */
function dominio(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

@Controller('plataforma')
export class PlataformaController {
  constructor(
    private readonly plataforma: PlataformaService,
    private readonly eventos: RegistroDeEventos,
    private readonly erros: RegistroDeErros,
  ) {}

  /**
   * Os passos de antes da conta: visitou, clicou, abriu o cadastro.
   *
   * Público (a pessoa ainda não tem conta) e barato de abusar, então: só
   * os três tipos previstos, uma vez por visitante por dia (a chave), e um
   * teto por IP. Nada de IP nem de caminho completo guardado.
   */
  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 30 } })
  @Post('eventos')
  @HttpCode(204)
  async evento(@Body() dto: EventoDoNavegadorDto) {
    await this.eventos.registrar(dto.tipo as TipoDeEvento, {
      visitante: dto.visitante,
      chave: `${dto.tipo}:${dto.visitante}:${dia()}`,
      dados: {
        ...(dto.caminho ? { caminho: dto.caminho.split('?')[0] } : {}),
        ...(dominio(dto.referencia)
          ? { referencia: dominio(dto.referencia) }
          : {}),
        ...(utmLimpo(dto.utm) ? { utm: utmLimpo(dto.utm) } : {}),
      },
    });
  }

  /** Erro da tela. Público porque também acontece na landing e no login. */
  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 20 } })
  @Post('erros')
  @HttpCode(204)
  async erro(@Body() dto: ErroDoNavegadorDto) {
    await this.erros.registrar({
      origem: 'web',
      mensagem: dto.mensagem,
      pilha: dto.pilha,
      rota: dto.rota,
      status: dto.status,
    });
  }

  // Daqui pra baixo, só o dono da plataforma. `BillingExempt` porque a
  // própria empresa dele pode estar sem assinatura — o painel da
  // plataforma não é uso do produto.

  @UseGuards(PlataformaGuard)
  @BillingExempt()
  @Get('relatorio')
  relatorio(@Query('dias') dias?: string) {
    const periodo = [7, 30, 90].includes(Number(dias)) ? Number(dias) : 30;
    return this.plataforma.relatorio(periodo);
  }

  @UseGuards(PlataformaGuard)
  @BillingExempt()
  @Get('contas')
  contas(@Query('busca') busca?: string) {
    return this.plataforma.contas(busca);
  }

  @UseGuards(PlataformaGuard)
  @BillingExempt()
  @Get('erros')
  listarErros(@Query('todos') todos?: string) {
    return this.plataforma.erros(todos === '1');
  }

  @UseGuards(PlataformaGuard)
  @BillingExempt()
  @Post('erros/:id/resolver')
  resolver(@Param('id') id: string) {
    return this.plataforma.resolverErro(id);
  }
}
