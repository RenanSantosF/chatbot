import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import {
  CreateRoutingRuleDto,
  UpdateRoutingRuleDto,
} from './dto/routing-rule.dto';
import { RoutingService } from './routing.service';

@Controller('routing-rules')
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  @Get()
  list() {
    return this.routingService.list();
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(@Body() dto: CreateRoutingRuleDto) {
    return this.routingService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateRoutingRuleDto) {
    return this.routingService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.routingService.remove(id);
  }
}
