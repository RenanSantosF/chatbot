import { Controller, Get, Query } from '@nestjs/common';
import { PreviaDeLinkService } from './previa-de-link.service';

/** A prévia de um link que apareceu numa conversa (ver PreviaDeLinkService). */
@Controller('link-preview')
export class PreviaDeLinkController {
  constructor(private readonly previas: PreviaDeLinkService) {}

  @Get()
  async buscar(@Query('url') url?: string) {
    if (!url) return { previa: null };
    return { previa: await this.previas.buscar(url) };
  }
}
