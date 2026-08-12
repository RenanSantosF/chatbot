import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  async download(@Param('mediaId') mediaId: string, @Res() res: Response) {
    const { buffer, mimeType } = await this.media.download(mediaId);
    res.setHeader('Content-Type', mimeType);
    // O id da mídia na Meta aponta sempre pro mesmo binário, então o
    // conteúdo é imutável: `immutable` faz o navegador nem revalidar,
    // e a imagem reaparece instantânea ao rolar a conversa de novo.
    // Privado porque é conteúdo de cliente — nunca em cache compartilhado.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('ETag', `"${mediaId}"`);
    res.send(buffer);
  }
}
