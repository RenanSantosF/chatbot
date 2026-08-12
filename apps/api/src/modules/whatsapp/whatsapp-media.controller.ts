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
    // A mídia na Meta é imutável e some depois de 30 dias; um cache privado
    // curto evita rebaixar o mesmo arquivo a cada rolagem da conversa.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }
}
