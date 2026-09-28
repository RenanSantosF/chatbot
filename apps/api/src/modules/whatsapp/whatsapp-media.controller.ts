import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CacheDeMiniaturas, gerarMiniatura, larguraPedida } from './miniatura';
import { WhatsappMediaService } from './whatsapp-media.service';

/**
 * Um cache só pro processo inteiro — o controlador é recriado a cada
 * requisição (os serviços dele têm escopo de requisição), e um cache
 * dentro dele morreria junto.
 */
const miniaturas = new CacheDeMiniaturas();

/**
 * Proxy autenticado pro binário das mídias. O painel aponta pra cá em vez
 * de pra Meta porque a URL da Meta expira em minutos e exige o token do
 * tenant — que jamais pode ir pro navegador. Como esta rota passa pelo
 * guard padrão, só quem está logado no tenant certo consegue baixar.
 */
@Controller('whatsapp/media')
export class WhatsappMediaController {
  private readonly logger = new Logger(WhatsappMediaController.name);

  constructor(private readonly media: WhatsappMediaService) {}

  /**
   * As figurinhas que já passaram por esta conta, pro seletor do
   * compositor. Devolve só os identificadores: o binário de cada uma vem
   * pela rota de baixo, que já sabe achar e servir com cache.
   *
   * ANTES da rota de `:mediaId`, e isso não é estilo: o Nest casa na ordem
   * de declaração, e depois dela "figurinhas" seria lido como o id de uma
   * mídia que não existe.
   */
  @Get('figurinhas')
  figurinhas() {
    return this.media.figurinhas();
  }

  @Get(':mediaId')
  async download(
    @Param('mediaId') mediaId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query('w') w?: string,
  ) {
    // `?w=` pede a miniatura (ver miniatura.ts). Sem ele, ou quando a
    // miniatura não vale a pena, vai a original — que é o que o
    // visualizador em tela cheia pede.
    const largura = larguraPedida(w);
    if (largura) {
      const miniatura = await this.miniatura(req, mediaId, largura);
      if (miniatura) {
        res.setHeader('Content-Type', miniatura.mimeType);
        res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
        res.setHeader('ETag', `"${mediaId}-w${largura}"`);
        res.setHeader('Content-Length', String(miniatura.buffer.length));
        res.send(miniatura.buffer);
        return;
      }
    }

    const { buffer, mimeType } = await this.media.download(mediaId);

    res.setHeader('Content-Type', mimeType);
    // O id da mídia na Meta aponta sempre pro mesmo binário, então o
    // conteúdo é imutável: `immutable` faz o navegador nem revalidar,
    // e a imagem reaparece instantânea ao rolar a conversa de novo.
    // Privado porque é conteúdo de cliente — nunca em cache compartilhado.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('ETag', `"${mediaId}"`);

    // Sem isto, áudio e vídeo viram um bloco que só toca do começo ao fim:
    // o navegador precisa pedir pedaços pra descobrir a duração e pra
    // deixar a pessoa arrastar a barra. Um <audio> sem resposta parcial
    // fica com a barra travada no fim e mostra duração inventada.
    res.setHeader('Accept-Ranges', 'bytes');

    const faixa = this.faixaPedida(req.headers.range, buffer.length);
    if (!faixa) {
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
      return;
    }

    res.status(HttpStatus.PARTIAL_CONTENT);
    res.setHeader(
      'Content-Range',
      `bytes ${faixa.inicio}-${faixa.fim}/${buffer.length}`,
    );
    res.setHeader('Content-Length', String(faixa.fim - faixa.inicio + 1));
    res.end(buffer.subarray(faixa.inicio, faixa.fim + 1));
  }

  /**
   * A miniatura, do cache ou gerada agora.
   *
   * A chave leva a empresa: o id da mídia é do WhatsApp, e nada garante
   * que duas empresas nunca vejam o mesmo — o cache não pode ser o
   * caminho de uma abrir a foto da outra. `download` já confere a posse;
   * o cache só é consultado com a empresa de quem pediu.
   */
  private async miniatura(req: Request, mediaId: string, largura: number) {
    const tenantId = (req as AuthenticatedRequest).user?.tenantId;
    if (!tenantId) return null;
    const chave = `${tenantId}:${mediaId}:${largura}`;

    const guardada = miniaturas.get(chave);
    if (guardada) return guardada;

    const original = await this.media.download(mediaId);
    try {
      const gerada = await gerarMiniatura(original, largura);
      if (gerada) miniaturas.set(chave, gerada);
      return gerada;
    } catch (erro) {
      // Arquivo que o sharp não lê (corrompido, formato exótico com mime
      // de foto): a original serve do mesmo jeito.
      this.logger.warn(
        `Miniatura de ${mediaId} falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
      return null;
    }
  }

  /**
   * Lê o cabeçalho `Range`. Só a forma simples "bytes=início-fim" — é a
   * única que navegador manda pra tocar mídia, e aceitar faixas múltiplas
   * exigiria resposta multipart que ninguém aqui pede.
   *
   * Devolve null quando não há pedido de faixa ou quando ele não faz
   * sentido; nesse caso o arquivo inteiro é servido, que é o que a norma
   * manda fazer com um Range que não dá pra satisfazer.
   */
  private faixaPedida(
    header: string | undefined,
    tamanho: number,
  ): { inicio: number; fim: number } | null {
    const casou = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
    if (!casou) return null;

    const [, cru1, cru2] = casou;

    // "bytes=-500" quer dizer os últimos 500 bytes — é assim que o
    // navegador lê o fim de um Ogg pra achar a duração.
    if (!cru1 && cru2) {
      const ultimos = Math.min(Number(cru2), tamanho);
      return ultimos > 0
        ? { inicio: tamanho - ultimos, fim: tamanho - 1 }
        : null;
    }
    if (!cru1) return null;

    const inicio = Number(cru1);
    const fim = cru2 ? Math.min(Number(cru2), tamanho - 1) : tamanho - 1;
    if (inicio > fim || inicio >= tamanho) return null;

    return { inicio, fim };
  }
}
