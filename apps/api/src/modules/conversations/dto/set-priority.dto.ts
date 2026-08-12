import { IsEnum } from 'class-validator';

export enum ConversationPriorityDto {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class SetPriorityDto {
  @IsEnum(ConversationPriorityDto)
  priority!: ConversationPriorityDto;
}
