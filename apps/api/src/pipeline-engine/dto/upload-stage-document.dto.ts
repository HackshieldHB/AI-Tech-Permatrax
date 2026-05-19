import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class UploadStageDocumentDto {
  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;
}

export class RecordSmileProgressDto {
  @IsNotEmpty()
  progressPct: number;

  @IsString()
  @IsOptional()
  evidenceUrl?: string;
}
