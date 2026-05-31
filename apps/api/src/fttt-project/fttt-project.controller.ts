import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FtttProjectService } from './fttt-project.service';
import {
  AdvancePhaseDto,
  AddJaminanDto,
  ApproveDocumentDto,
  CreateFtttProjectDto,
  FtttProjectFilterDto,
  ResolveSanggahDto,
  SubmitSanggahDto,
  UploadDocumentDto,
  UploadDrmDocDto,
  UploadSurveyDto,
} from './fttt-project.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Role } from '@prisma/client';

const upload = { storage: memoryStorage() };

@UseGuards(JwtAuthGuard)
@Controller('fttt-projects')
export class FtttProjectController {
  constructor(private readonly service: FtttProjectService) {}

  // POST /fttt-projects  (multipart: triggerDoc + JSON fields)
  @Post()
  @UseInterceptors(FileInterceptor('triggerDoc', upload))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body('data') rawData: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const dto = CreateFtttProjectDto.parse(JSON.parse(rawData));
    return this.service.create(dto, file, user.id);
  }

  // GET /fttt-projects
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(FtttProjectFilterDto)) filters: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.findAll(filters, user.id, user.role);
  }

  // GET /fttt-projects/:id
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.findOne(id, user.id, user.role);
  }

  // GET /fttt-projects/:id/progress  — live progress bar data
  @Get(':id/progress')
  getProgress(@Param('id') id: string) {
    return this.service.getProgress(id);
  }

  // GET /fttt-projects/:id/phase-readiness
  @Get(':id/phase-readiness')
  checkReadiness(@Param('id') id: string) {
    return this.service.checkPhaseReadiness(id);
  }

  // POST /fttt-projects/:id/advance-phase
  @Post(':id/advance-phase')
  advancePhase(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdvancePhaseDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.advancePhase(id, dto, user.id);
  }

  // POST /fttt-projects/:id/survey-uploads
  @Post(':id/survey-uploads')
  @UseInterceptors(FileInterceptor('file', upload))
  uploadSurvey(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadSurveyDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.uploadSurveyEvidence(id, file, dto, user.id);
  }

  // POST /fttt-projects/:id/drm-documents
  @Post(':id/drm-documents')
  @UseInterceptors(FileInterceptor('file', upload))
  uploadDrm(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadDrmDocDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.uploadDrmDocument(id, file, dto, user.id);
  }

  // GET /fttt-projects/:id/drm-documents
  @Get(':id/drm-documents')
  getDrmHistory(@Param('id') id: string) {
    return this.service.getDrmHistory(id);
  }

  // POST /fttt-projects/:id/sanggah
  @Post(':id/sanggah')
  @UseInterceptors(FileInterceptor('file', upload))
  submitSanggah(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(SubmitSanggahDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.submitSanggah(id, dto, file, user.id);
  }

  // PUT /fttt-projects/sanggah/:sanggahId/resolve
  @Put('sanggah/:sanggahId/resolve')
  resolveSanggah(
    @Param('sanggahId') sanggahId: string,
    @Body(new ZodValidationPipe(ResolveSanggahDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.resolveSanggah(sanggahId, dto, user.id);
  }

  // POST /fttt-projects/:id/jaminan
  @Post(':id/jaminan')
  @UseInterceptors(FileInterceptor('file', upload))
  addJaminan(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(AddJaminanDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.addJaminan(id, dto, file, user.id);
  }

  // POST /fttt-projects/:id/documents
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', upload))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadDocumentDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.uploadDocument(id, file, dto, user.id);
  }

  // PUT /fttt-projects/documents/:docId/approve
  @Put('documents/:docId/approve')
  approveDocument(
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(ApproveDocumentDto)) dto: any,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.service.approveDocument(docId, dto, user.id, user.role);
  }
}
