import { Controller, Get, HttpStatus, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WhatsappMediaService } from './whatsapp-media.service';

/**
 * Proxy autenticado pro binário das mídias. O painel aponta pra cá em vez
 * de pra Meta porque a URL da Meta expira em minutos e exige o token do
 * tenant — que jamais pode ir pro navegador. Como esta rota passa pelo
 * guard padrão, só quem está logado no tenant certo consegue baixar.
 */
@Controller('whatsapp/media')
export class WhatsappMediaController {
  constructor(private readonly media: WhatsappMediaService) {}

  @Get(':mediaId')
  async download(
    @Param('mediaId') mediaId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
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
