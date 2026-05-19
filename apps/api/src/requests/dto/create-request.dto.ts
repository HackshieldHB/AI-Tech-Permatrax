import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RequestType } from '@permatrack/db';

export class CreateRequestDto {
  @ApiProperty({ enum: RequestType })
  @IsEnum(RequestType)
  @IsNotEmpty()
  type: RequestType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  requestedBy: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assignedToRole: string;
}
