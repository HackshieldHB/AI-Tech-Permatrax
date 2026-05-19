import { Controller, Get, Post, Body, Param, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SurveyDataService } from './survey-data.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { FilesInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';

@ApiTags('Survey Data')
@Controller('permit-clusters/:clusterId/survey')
export class SurveyDataController {
  constructor(
    private readonly surveyDataService: SurveyDataService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
  )
  async findOne(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.surveyDataService.findOne(clusterId, req.user.userId, req.user.role);
  }

  @Post()
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async createOrUpdate(@Param('clusterId') clusterId: string, @Body() body: Record<string, unknown>, @Req() req: any) {
    return this.surveyDataService.createOrUpdate(clusterId, body, req.user.userId, req.user.role);
  }

  @Post('site-visit')
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async siteVisit(@Param('clusterId') clusterId: string, @Body() body: Record<string, unknown>, @Req() req: any) {
    return this.surveyDataService.submitSiteVisit(clusterId, body, req.user.userId, req.user.role);
  }

  @Post('survey-input')
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async surveyInput(@Param('clusterId') clusterId: string, @Body() body: Record<string, unknown>, @Req() req: any) {
    return this.surveyDataService.submitSurveyInput(clusterId, body, req.user.userId, req.user.role);
  }

  @Post('route-survey')
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async routeSurvey(@Param('clusterId') clusterId: string, @Body() body: Record<string, unknown>, @Req() req: any) {
    return this.surveyDataService.submitRouteSurvey(clusterId, body, req.user.userId, req.user.role);
  }

  @Post('evidence')
  @UseInterceptors(FilesInterceptor('photos', 10))
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async uploadEvidence(@Param('clusterId') clusterId: string, @UploadedFiles() files: Express.Multer.File[], @Body() body: Record<string, string>, @Req() req: any) {
    const year = new Date().getFullYear();
    const uploaded = await Promise.all(
      (files ?? []).map(async (f) => {
        const key = `survey/${year}/${clusterId}/${Date.now()}-${f.originalname}`; // NEW: S3 key pattern for survey evidences
        const fileUrl = await this.storageService.uploadBuffer(key, f.buffer, f.mimetype);
        return { fileUrl, fileName: f.originalname, mimeType: f.mimetype, fileSize: f.size };
      }),
    );
    return this.surveyDataService.addEvidence(
      clusterId,
      uploaded,
      {
        latitude: body.latitude ? Number(body.latitude) : undefined,
        longitude: body.longitude ? Number(body.longitude) : undefined,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : undefined,
      },
      req.user.userId,
    );
  }

  @Get('evidence')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  async evidence(@Param('clusterId') clusterId: string) {
    return this.surveyDataService.getEvidenceForCluster(clusterId); // NEW: evidence list with GPS metadata
  }
}
