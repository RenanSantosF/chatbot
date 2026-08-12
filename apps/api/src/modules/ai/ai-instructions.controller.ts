import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { AiInstructionsService } from './ai-instructions.service';
import { CreateAiInstructionDto, UpdateAiInstructionDto } from './dto/ai-instruction.dto';

@Controller('ai/instructions')
@RequiresPermission('ai.manage')
export class AiInstructionsController {
  constructor(private readonly aiInstructionsService: AiInstructionsService) {}

  @Get()
  list() {
    return this.aiInstructionsService.list();
  }

  @Post()
  create(@Body() dto: CreateAiInstructionDto) {
    return this.aiInstructionsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAiInstructionDto) {
    return this.aiInstructionsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.aiInstructionsService.remove(id);
  }
}
