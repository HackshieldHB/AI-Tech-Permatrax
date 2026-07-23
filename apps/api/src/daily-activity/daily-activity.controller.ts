import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DailyActivityService } from './daily-activity.service';
import type { EvidenceFileInput } from './daily-activity.service';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  FilterDailyActivityDto,
  UpdateDailyActivityDto,
  type FilterDailyActivityDtoType,
  type UpdateDailyActivityDtoType,
} from './daily-activity.dto';

const upload = { storage: memoryStorage() };

@ApiTags('Daily Activity')
@Controller('daily-activities')
export class DailyActivityController {
  constructor(
    private readonly service: DailyActivityService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  @Roles(...PERMISSIONS.DAILY_ACTIVITY_VIEW)
  @ApiOperation({ summary: 'Daftar Daily Activity (paginated, filter search/workStatus/project)' })
  async findAll(@Query(new ZodValidationPipe(FilterDailyActivityDto)) filter: FilterDailyActivityDtoType) {
    return this.service.findAll(filter);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.DAILY_ACTIVITY_VIEW)
  @ApiOperation({ summary: 'Detail Daily Activity' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(...PERMISSIONS.DAILY_ACTIVITY_MANAGE)
  @ApiOperation({ summary: 'Update status/monitoring Daily Activity (workStatus, targetDoneAt, remarks, evidenceUrl)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDailyActivityDto)) dto: UpdateDailyActivityDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/evidence')
  @Roles(...PERMISSIONS.DAILY_ACTIVITY_MANAGE)
  @ApiOperation({ summary: 'Upload bukti pekerjaan (multi-file: jpg/png/pdf/doc/docx/xls/xlsx/zip) untuk Daily Activity' })
  @UseInterceptors(FilesInterceptor('files', 10, upload))
  async uploadEvidence(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body('evidenceUrl') evidenceUrl: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const inputs: EvidenceFileInput[] = [];

    for (const file of files ?? []) {
      const fileUrl = await this.storageService.uploadMulterFile(file, 'daily-activity', id);
      inputs.push({
        fileUrl,
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
      });
    }

    // Back-compat: legacy callers may still submit a plain evidenceUrl instead of a file.
    if (inputs.length === 0 && evidenceUrl) {
      inputs.push({ fileUrl: evidenceUrl });
    }

    if (inputs.length === 0) {
      throw new BadRequestException('File atau evidenceUrl wajib diisi');
    }

    return this.service.addEvidenceFiles(id, inputs, user);
  }
}
