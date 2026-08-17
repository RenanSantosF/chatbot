import { Module } from '@nestjs/common';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { RetentionSweepService } from './retention-sweep.service';

@Module({
  controllers: [RetentionController],
  providers: [RetentionService, RetentionSweepService],
  exports: [RetentionService],
})
export class RetentionModule {}
