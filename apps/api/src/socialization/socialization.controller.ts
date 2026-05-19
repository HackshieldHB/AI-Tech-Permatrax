import { Controller, Get, Post, Patch, Param, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SocializationService } from './socialization.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { SocializationAgreement } from '@prisma/client';

@ApiTags('Socialization')
@Controller('permit-clusters/:clusterId/socialization')
export class SocializationController {
  constructor(private readonly socializationService: SocializationService) {}

  @Post()
  @Roles(...PERMISSIONS.SOCIALIZATION_CREATE)
  @ApiOperation({ summary: 'Buat rekaman sosialisasi + PDF otomatis' })
  async create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      conductedAt: string;
      location: string;
      attendees: object;
      constructionScope?: string;
      affectedRoutes?: string;
      plannedSchedule?: string;
      communityFeedback?: string;
    },
    @Req() req: any,
  ) {
    return this.socializationService.create(clusterId, body, req.user.userId);
  }

  @Patch(':id/agreement')
  @Roles(...PERMISSIONS.SOCIALIZATION_VIEW)
  @ApiOperation({ summary: 'Update status kesepakatan' })
  async agreement(
    @Param('id') id: string,
    @Body() body: { status: SocializationAgreement },
    @Req() req: any,
  ) {
    return this.socializationService.updateAgreementStatus(id, body.status, req.user.userId);
  }

  @Post(':id/evidence')
  @Roles(...PERMISSIONS.SOCIALIZATION_CREATE)
  @ApiOperation({ summary: 'Tambah URL foto bukti' })
  async evidence(
    @Param('id') id: string,
    @Body() body: { photoUrls: string[] },
    @Req() req: any,
  ) {
    return this.socializationService.uploadEvidence(id, body.photoUrls, req.user.userId);
  }
}
