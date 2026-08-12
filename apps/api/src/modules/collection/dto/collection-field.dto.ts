import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum CollectionFieldTypeDto {
  TEXT = 'TEXT',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  DOCUMENT = 'DOCUMENT',
  DATE = 'DATE',
  NUMBER = 'NUMBER',
}

export enum CollectionFieldTargetDto {
  NAME = 'NAME',
  EMAIL = 'EMAIL',
  METADATA = 'METADATA',
}

export class CreateCollectionFieldDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsEnum(CollectionFieldTypeDto)
  type?: CollectionFieldTypeDto;

  @IsOptional()
  @IsEnum(CollectionFieldTargetDto)
  target?: CollectionFieldTargetDto;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class UpdateCollectionFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsEnum(CollectionFieldTypeDto)
  type?: CollectionFieldTypeDto;

  @IsOptional()
  @IsEnum(CollectionFieldTargetDto)
  target?: CollectionFieldTargetDto;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}
