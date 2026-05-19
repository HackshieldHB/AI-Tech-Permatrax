import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@permatrack/db';

export class GenerateDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  @IsNotEmpty()
  type: DocumentType;
}

export class UploadSignedDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  documentId: string;
}
