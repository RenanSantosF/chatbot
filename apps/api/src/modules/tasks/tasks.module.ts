import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [ConversationsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
