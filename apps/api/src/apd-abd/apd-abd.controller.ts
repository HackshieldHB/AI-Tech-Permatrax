import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApdAbdService } from './apd-abd.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { TechnicalDiagramType } from '@prisma/client';

@ApiTags('APD / ABD')
@Controller('permit-clusters/:clusterId/design')
export class ApdAbdController {
  constructor(private readonly apdAbdService: ApdAbdService) {}

  @Get()
  @Roles(...PERMISSIONS.APD_VIEW)
  @ApiOperation({ summary: 'APD + ABD + revisi + diagram' })
  async getDesign(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.apdAbdService.getApdAbd(clusterId, req.user.userId, req.user.role);
  }

  @Post('apd')
  @Roles(...PERMISSIONS.APD_CREATE)
  @ApiOperation({ summary: 'Buat APD draft' })
  async createApd(
    @Param('clusterId') clusterId: string,
    @Body() body: { notes?: string },
    @Req() req: any,
  ) {
    return this.apdAbdService.createApd(clusterId, body, req.user.userId, req.user.role);
  }

  @Patch('apd/:apdId/gis')
  @Roles(...PERMISSIONS.APD_CREATE)
  @ApiOperation({ summary: 'Update data rute GIS' })
  async patchGis(
    @Param('apdId') apdId: string,
    @Body() body: { gisRouteData: object },
    @Req() req: any,
  ) {
    return this.apdAbdService.updateApdGis(apdId, body.gisRouteData, req.user.userId);
  }

  @Post('apd/:apdId/submit-drm')
  @Roles(...PERMISSIONS.APD_CREATE)
  @ApiOperation({ summary: 'Submit ke DRM' })
  async submitDrm(
    @Param('apdId') apdId: string,
    @Body() body: { drmScheduledAt: string },
    @Req() req: any,
  ) {
    return this.apdAbdService.submitApdForDrm(
      apdId,
      new Date(body.drmScheduledAt),
      req.user.userId,
    );
  }

  @Post('apd/:apdId/drm-decision')
  @Roles(...PERMISSIONS.DRM_APPROVE)
  @ApiOperation({ summary: 'Keputusan DRM (PM Senior)' })
  async drmDecision(
    @Param('apdId') apdId: string,
    @Body() body: { action: 'APPROVE' | 'REVISE'; notes: string },
    @Req() req: any,
  ) {
    return this.apdAbdService.conductDrm(apdId, body.notes, body.action, req.user.userId);
  }

  @Post('abd/:abdId/submit-isp')
  @Roles(...PERMISSIONS.ABD_SUBMIT)
  @ApiOperation({ summary: 'Submit ABD ke ISP' })
  async submitIsp(
    @Param('abdId') abdId: string,
    @Body() body: { fileUrl: string; notes?: string },
    @Req() req: any,
  ) {
    return this.apdAbdService.submitAbdToIsp(abdId, body.fileUrl, body.notes, req.user.userId);
  }

  @Post('abd/:abdId/isp-decision')
  @Roles(...PERMISSIONS.ABD_APPROVE)
  @ApiOperation({ summary: 'Keputusan ISP (dicatat PM Senior/GM)' })
  async ispDecision(
    @Param('abdId') abdId: string,
    @Body() body: { action: 'APPROVE' | 'REVISE'; feedback: string },
    @Req() req: any,
  ) {
    return this.apdAbdService.recordIspDecision(abdId, body.action, body.feedback, req.user.userId);
  }

  @Post('abd/:abdId/diagrams')
  @Roles(...PERMISSIONS.APD_CREATE)
  @ApiOperation({ summary: 'Upload diagram teknis' })
  async diagram(
    @Param('abdId') abdId: string,
    @Body() body: { type: TechnicalDiagramType; fileUrl: string },
    @Req() req: any,
  ) {
    return this.apdAbdService.uploadTechnicalDiagram(abdId, body.type, body.fileUrl, req.user.userId);
  }
}
