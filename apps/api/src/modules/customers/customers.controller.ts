import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list() {
    return this.customersService.list();
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
