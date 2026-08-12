import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { CreateQueueDto, UpdateQueueDto } from './dto/queue.dto';
import { QueuesService } from './queues.service';

@Controller('queues')
export class QueuesController {
  constructor(private readonly queuesService: QueuesService) {}

  @Get()
  list() {
    return this.queuesService.list();
  }

  @Post()
  @RequiresPermission('queues.manage')
  create(@Body() dto: CreateQueueDto) {
    return this.queuesService.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('queues.manage')
  update(@Param('id') id: string, @Body() dto: UpdateQueueDto) {
    return this.queuesService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('queues.manage')
  remove(@Param('id') id: string) {
    return this.queuesService.remove(id);
  }

  @Post(':id/members/:userId')
  @RequiresPermission('queues.manage')
  addMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.queuesService.addMember(id, userId);
  }

  @Delete(':id/members/:userId')
  @RequiresPermission('queues.manage')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.queuesService.removeMember(id, userId);
  }
}
