import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list() {
    return this.tags.list();
  }

  /**
   * Criar etiqueta é de quem atende, e não de quem configura.
   *
   * É o ponto do recurso: quem está com a conversa aberta percebe que
   * "Segunda via" se repete o dia inteiro e cria ali, sem sair da tela e
   * sem pedir pra ninguém. Etiqueta errada não fala com o cliente, não muda
   * cobrança e some com um clique — o custo de errar é baixo demais pra
   * justificar burocracia. Renomear e apagar continuam pedindo permissão,
   * porque aí o efeito é sobre o trabalho de todo mundo.
   */
  @Post()
  create(@Body() dto: CreateTagDto) {
    return this.tags.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('tags.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tags.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('tags.manage')
  remove(@Param('id') id: string) {
    return this.tags.remove(id);
  }
}
