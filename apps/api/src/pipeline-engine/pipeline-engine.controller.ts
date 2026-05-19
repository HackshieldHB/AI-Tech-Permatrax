import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PipelineEngineService } from './pipeline-engine.service';
import { CreatePipelineTemplateDto } from './dto/create-template.dto';
import { AdvanceStageDto, ManualUnlockDto } from './dto/advance-stage.dto';
import { RecordSmileProgressDto, UploadStageDocumentDto } from './dto/upload-stage-document.dto';

@Controller('pipeline-engine')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PipelineEngineController {
  constructor(private readonly service: PipelineEngineService) {}

  @Get('templates')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER)
  async listTemplates() {
    // Basic implementation for admin list
    return this.service['prisma'].pipelineTemplate.findMany({
      include: { ispCustomer: { select: { name: true } }, _count: { select: { stages: true } } },
    });
  }

  @Get('templates/:id')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER, Role.PM_FTTT)
  async getTemplate(@Param('id') id: string) {
    return this.service['prisma'].pipelineTemplate.findUnique({
      where: { id },
      include: { stages: { include: { requiredDocuments: true }, orderBy: { sequence: 'asc' } } },
    });
  }

  @Post('templates')
  @Roles(Role.ADMIN)
  async createTemplate(@Body() dto: CreatePipelineTemplateDto) {
    return this.service.seedTemplate(dto);
  }

  @Get('clusters/:clusterId/progress')
  async getClusterProgress(@Param('clusterId') clusterId: string) {
    return this.service.getClusterProgress(clusterId);
  }

  @Post('clusters/:clusterId/stages/:stageId/advance')
  async advanceStage(
    @Param('clusterId') clusterId: string,
    @Param('stageId') stageId: string,
    @Body() dto: AdvanceStageDto,
    @Req() req: any,
  ) {
    return this.service.advanceStage(
      clusterId,
      stageId,
      req.user.id,
      req.user.role,
      dto.notes,
    );
  }

  @Post('clusters/:clusterId/stages/:stageId/unlock')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER)
  async manualUnlock(
    @Param('clusterId') clusterId: string,
    @Param('stageId') stageId: string,
    @Body() dto: ManualUnlockDto,
    @Req() req: any,
  ) {
    return this.service.manualUnlockStage(clusterId, stageId, req.user.id, dto.reason);
  }

  @Post('clusters/:clusterId/stages/:stageId/documents/:docId')
  async uploadDocument(
    @Param('clusterId') clusterId: string,
    @Param('stageId') stageId: string,
    @Param('docId') docId: string,
    @Body() dto: UploadStageDocumentDto,
    @Req() req: any,
  ) {
    // Note: In a real app, you'd use FileInterceptor here. 
    // This assumes the file is already uploaded to storage and we just link the URL.
    return this.service.uploadStageDocument(
      clusterId,
      docId,
      dto.fileUrl,
      dto.fileName,
      req.user.id,
    );
  }

  @Get('clusters/:clusterId/stages/:stageId/documents')
  async getDocuments(
    @Param('clusterId') clusterId: string,
    @Param('stageId') stageId: string,
  ) {
    return this.service.checkStageDocuments(clusterId, stageId);
  }

  @Post('clusters/:clusterId/smile-progress')
  @Roles(Role.PM_FTTT, Role.SURVEYOR_FTTT, Role.ADMIN)
  async recordSmile(
    @Param('clusterId') clusterId: string,
    @Body() dto: RecordSmileProgressDto,
    @Req() req: any,
  ) {
    return this.service.recordSmileProgress(
      clusterId,
      dto.progressPct,
      dto.evidenceUrl || null,
      req.user.id,
    );
  }

  @Get('clusters/:clusterId/smile-progress')
  async getSmileHistory(@Param('clusterId') clusterId: string) {
    return this.service['prisma'].smileProgress.findMany({
      where: { clusterId },
      orderBy: { recordedAt: 'desc' },
    });
  }
}
