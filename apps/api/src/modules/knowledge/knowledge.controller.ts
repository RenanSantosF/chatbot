import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { KnowledgeService } from './knowledge.service';
import { SUPPORTED_MIME_TYPES } from './parsing/extract-text';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('knowledge/documents')
@RequiresPermission('knowledge.manage')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  list() {
    return this.knowledgeService.list();
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!SUPPORTED_MIME_TYPES.includes(file.mimetype as (typeof SUPPORTED_MIME_TYPES)[number])) {
          callback(new BadRequestException('Tipo de arquivo não suportado. Envie PDF, DOCX, TXT, CSV ou XLSX.'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Body('title') title?: string) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    return this.knowledgeService.uploadDocument(file, title);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.knowledgeService.remove(id);
  }
}
