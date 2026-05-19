import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdvanceStageDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ManualUnlockDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
