import { FiberType } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsJSON, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStageDocumentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString({ each: true })
  formats: string[];

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;
}

export class CreatePipelineStageDto {
  @IsInt()
  sequence: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  shortLabel: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsOptional()
  triggerConditions?: any;

  @IsBoolean()
  @IsOptional()
  autoAdvance?: boolean;

  @IsString({ each: true })
  notifyRoles: string[];

  @IsString({ each: true })
  allowedActorRoles: string[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateStageDocumentDto)
  requiredDocuments?: CreateStageDocumentDto[];
}

export class CreatePipelineTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(FiberType)
  fiberType: FiberType;

  @IsString()
  @IsNotEmpty()
  ispCustomerId: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ValidateNested({ each: true })
  @Type(() => CreatePipelineStageDto)
  stages: CreatePipelineStageDto[];
}
