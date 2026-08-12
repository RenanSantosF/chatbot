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
import {
  CreateCollectionFieldDto,
  UpdateCollectionFieldDto,
} from './dto/collection-field.dto';
import { CollectionService } from './collection.service';

@Controller('collection-fields')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get()
  list() {
    return this.collectionService.list();
  }

  @Post()
  @RequiresPermission('ai.manage')
  create(@Body() dto: CreateCollectionFieldDto) {
    return this.collectionService.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('ai.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCollectionFieldDto) {
    return this.collectionService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('ai.manage')
  remove(@Param('id') id: string) {
    return this.collectionService.remove(id);
  }
}
