import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
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
  @Roles('OWNER', 'ADMIN')
  create(@Body() dto: CreateQueueDto) {
    return this.queuesService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateQueueDto) {
    return this.queuesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.queuesService.remove(id);
  }

  @Post(':id/members/:userId')
  @Roles('OWNER', 'ADMIN')
  addMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.queuesService.addMember(id, userId);
  }

  @Delete(':id/members/:userId')
  @Roles('OWNER', 'ADMIN')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.queuesService.removeMember(id, userId);
  }
}
