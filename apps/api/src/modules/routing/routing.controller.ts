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
  @RequiresPermission('routing.manage')
  create(@Body() dto: CreateRoutingRuleDto) {
    return this.routingService.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('routing.manage')
  update(@Param('id') id: string, @Body() dto: UpdateRoutingRuleDto) {
    return this.routingService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('routing.manage')
  remove(@Param('id') id: string) {
    return this.routingService.remove(id);
  }
}
