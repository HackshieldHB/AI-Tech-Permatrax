import { Controller, Get, Post, Patch, Body, Param, Query, Req, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SipService } from './sip.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Role } from '@prisma/client';
import { DownloadTokenService } from '../common/services/download-token.service'; // FIX: HMAC signed URLs

@ApiTags('SIP')
@Controller('permit-clusters/:clusterId/sip')
export class SipController {
  constructor(
    private readonly sipService: SipService,
    private readonly downloadTokenService: DownloadTokenService, // FIX: HMAC token generator/verifier
  ) {}

  @Get()
  @Roles(
    Role.SURVEYOR_FTTH, // FIX: SIP view includes surveyor roles per official flow
    Role.SURVEYOR_FTTB, // FIX: SIP view includes surveyor roles per official flow
    Role.SURVEYOR_FTTT, // FIX: SIP view includes surveyor roles per official flow
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
  )
  async getOne(@Param('clusterId') clusterId: string) {
    return this.sipService.getByCluster(clusterId);
  }

  @Post('init')
  @Roles( // FIX: Surveyor/PM/Admin can initialize SIP form
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async init(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.sipService.initSip(clusterId, req.user.userId); // NEW: initialize SIP with autofill
  }

  @Post(':sipId/generate-pdf')
  @Roles(Role.ADMIN)
  async generatePdf(@Param('sipId') sipId: string, @Req() req: any) {
    return this.sipService.generateSipPdf(sipId, req.user.userId); // NEW: generate SIP PDF after edits
  }

  @Patch(':sipId')
  @Roles( // FIX: Surveyor/PM/Admin can fill and update SIP fields
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async update(@Param('sipId') sipId: string, @Body() body: Record<string, unknown>) {
    return this.sipService.updateSip(sipId, body); // FIX: RESTful PATCH route for SIP field updates
  }

  @Post(':sipId/submit-to-isp')
  @Roles(Role.ADMIN) // FIX: only Admin submits SIP to ISP
  async submit(@Param('clusterId') clusterId: string, @Param('sipId') sipId: string, @Req() req: any) {
    const sip = await this.sipService.getByCluster(clusterId);
    if (!sip || sip.id !== sipId) throw new BadRequestException('SIP belum dibuat');
    return this.sipService.submitToIsp(sipId, req.user.userId);
  }

  @Post(':sipId/isp-decision')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER) // FIX: only Admin/GM records ISP decision
  async decision(
    @Param('clusterId') clusterId: string,
    @Param('sipId') sipId: string,
    @Body() body: { action: 'APPROVE' | 'REJECT' | 'REVISE'; feedback?: string },
    @Req() req: any,
  ) {
    const sip = await this.sipService.getByCluster(clusterId);
    if (!sip || sip.id !== sipId) throw new BadRequestException('SIP belum dibuat');
    return this.sipService.recordIspDecision(sipId, body.action, body.feedback, req.user.userId);
  }

  // FIX: authenticated endpoint — hand out signed, short-lived URL for SIP download
  @Get('download-url')
  @Roles(
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.GENERAL_MANAGER,
  )
  async getDownloadUrl(@Param('clusterId') clusterId: string) {
    const token = this.downloadTokenService.generate(clusterId, 3600);
    const apiBase =
      process.env.FILE_BASE_URL?.replace(/\/files$/, '') ||
      `http://localhost:${process.env.PORT || 3001}/api`;
    return {
      url: `${apiBase}/permit-clusters/${clusterId}/sip/download?token=${encodeURIComponent(token)}`,
      expiresIn: 3600,
    };
  }

  @Get('download')
  @Public() // FIX: JSON presigned URL may be opened from plain links — no JWT on new tab
  async download(
    @Param('clusterId') clusterId: string,
    @Query('token') token: string | undefined, // FIX: optional HMAC token — verify if present
  ) {
    if (token) {
      const valid = this.downloadTokenService.verify(token, clusterId);
      if (!valid) {
        throw new UnauthorizedException('Download link expired or invalid. Please request a new one.');
      }
    }
    const sip = await this.sipService.getByCluster(clusterId);
    if (!sip) throw new BadRequestException('SIP belum dibuat');
    const url = await this.sipService.presignedDownload(sip.id);
    return { url };
  }
}
