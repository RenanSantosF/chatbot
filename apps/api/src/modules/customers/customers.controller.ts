import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.types';
import { parseContactsCsv } from './contact-import';
import { CustomerNotesService } from './customer-notes.service';
import { CustomersService } from './customers.service';
import {
  CreateCustomerNoteDto,
  UpdateCustomerNoteDto,
} from './dto/customer-note.dto';

/** Planilha de contatos é texto; 5 MB já cobre dezenas de milhares de linhas. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly notes: CustomerNotesService,
  ) {}

  @Get()
  list() {
    return this.customersService.list();
  }

  /**
   * Importa contatos de um CSV. Devolve o que entrou e o que foi recusado,
   * linha a linha: importação que engole erro em silêncio faz a empresa
   * descobrir o problema semanas depois, quando a mensagem não chega.
   */
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async import(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Envie um arquivo CSV.');
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new BadRequestException('Arquivo muito grande (máximo 5 MB).');
    }

    const { contacts, rejected } = parseContactsCsv(file.buffer.toString('utf8'));
    if (contacts.length === 0) {
      throw new BadRequestException(
        'Nenhum contato válido no arquivo. Confira se há uma coluna de telefone.',
      );
    }

    const resultado = await this.customersService.importContacts(contacts);
    return { ...resultado, recusados: rejected };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const customer = await this.customersService.getById(id);
    if (!customer) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return customer;
  }

  // Anotações e pendências da ficha do cliente. Sem @Roles: quem atende é
  // quem sabe o que está pendente, então quem atende registra.
  @Get(':id/notes')
  listNotes(@Param('id') id: string) {
    return this.notes.list(id);
  }

  @Post(':id/notes')
  createNote(
    @Param('id') id: string,
    @Body() dto: CreateCustomerNoteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notes.create(id, user.userId, dto);
  }

  @Patch('notes/:noteId')
  updateNote(@Param('noteId') noteId: string, @Body() dto: UpdateCustomerNoteDto) {
    return this.notes.update(noteId, dto);
  }

  @Delete('notes/:noteId')
  removeNote(@Param('noteId') noteId: string) {
    return this.notes.remove(noteId);
  }
}
