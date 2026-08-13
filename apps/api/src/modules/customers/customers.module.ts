import { Module } from '@nestjs/common';
import { CustomerNotesService } from './customer-notes.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerNotesService],
  exports: [CustomersService, CustomerNotesService],
})
export class CustomersModule {}
