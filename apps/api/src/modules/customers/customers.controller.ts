import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parseContactsCsv } from './contact-import';
import { CustomersService } from './customers.service';

/** Planilha de contatos é texto; 5 MB já cobre dezenas de milhares de linhas. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

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
}
