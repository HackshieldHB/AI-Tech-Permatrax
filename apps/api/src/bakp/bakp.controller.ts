import { Controller, Get, Post, Param, Body, Query, Req, UnauthorizedException, NotFoundException } from '@nestjs/common'; // FIX: 404 when BAKP missing
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BakpService } from './bakp.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { BakpIspDecision, Role } from '@prisma/client';
import { DownloadTokenService } from '../common/services/download-token.service'; // FIX: HMAC signed URLs

@ApiTags('BAKP')
@Controller('permit-clusters/:clusterId/bakp')
export class BakpController {
  constructor(
    private readonly bakpService: BakpService,
    private readonly downloadTokenService: DownloadTokenService, // FIX: HMAC token generator/verifier
  ) {}

  @Get()
  @Roles(
    Role.ADMIN, // FIX
    Role.PM_SENIOR, // FIX
    Role.GENERAL_MANAGER, // FIX
    Role.PM_FTTH, // FIX
    Role.PM_FTTB, // FIX
    Role.PM_FTTT, // FIX
    Role.FINANCE, // FIX
    Role.SURVEYOR_FTTH, // FIX
    Role.SURVEYOR_FTTB, // FIX
    Role.SURVEYOR_FTTT, // FIX
    Role.OPERATIONAL_MANAGER, // FIX: ops visibility
  ) // FIX: Surveyor loads BAKP panel in phase 17
  @ApiOperation({ summary: 'Data BAKP + auto-checklist' })
  async getBakp(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.bakpService.getBakp(clusterId, req.user.userId, req.user.role); // FIX: may be null → frontend init
  }

  @Post('init') // FIX: static path before :bakpId routes
  @Roles(
    Role.SURVEYOR_FTTH, // FIX
    Role.SURVEYOR_FTTB, // FIX
    Role.SURVEYOR_FTTT, // FIX
    Role.PM_FTTH, // FIX
    Role.PM_FTTB, // FIX
    Role.PM_FTTT, // FIX
    Role.PM_SENIOR, // FIX
    Role.ADMIN, // FIX
  )
  @ApiOperation({ summary: 'Inisialisasi BAKP manual (fallback)' })
  async initBakpRoute(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.bakpService.initBakp(clusterId, req.user.userId); // FIX
  }

  @Get('checklist')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Checklist terstruktur' })
  async checklist(@Param('clusterId') clusterId: string, @Req() req: any) {
    const bakp = await this.bakpService.getBakp(clusterId, req.user.userId, req.user.role); // FIX
    if (!bakp) throw new NotFoundException('BAKP belum tersedia'); // FIX
    return this.bakpService.getChecklistDto(bakp.id); // FIX
  }

  @Post('payment')
  @Roles(...PERMISSIONS.BAKP_PAYMENT_UPLOAD)
  @ApiOperation({ summary: 'Unggah bukti pembayaran (Finance)' })
  async payment(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      transferProofUrl?: string;
      receiptUrl?: string;
      paymentPhotoUrl?: string;
      paymentAmount?: string;
      paymentDate?: string;
    },
    @Req() req: any,
  ) {
    const bakp = await this.bakpService.getBakp(clusterId, req.user.userId, req.user.role); // FIX
    if (!bakp) throw new NotFoundException('BAKP belum tersedia'); // FIX
    return this.bakpService.uploadPaymentProof(bakp.id, body, req.user.userId); // FIX
  }

  @Post('documents')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT)
  @ApiOperation({ summary: 'Unggah dokumen manual (KTP, SK, SIP, kuitansi)' })
  async manual(
    @Param('clusterId') clusterId: string,
    @Body() body: { docType: 'rtRwKtp' | 'rtRwSk' | 'sip' | 'receipt'; fileUrl: string },
    @Req() req: any,
  ) {
    const bakp = await this.bakpService.getBakp(clusterId, req.user.userId, req.user.role); // FIX
    if (!bakp) throw new NotFoundException('BAKP belum tersedia'); // FIX
    return this.bakpService.uploadManualDoc(
      bakp.id, // FIX
      body.docType,
      body.fileUrl,
      req.user.userId,
      req.user.role,
    );
  }

  @Post('submit')
  @Roles(Role.ADMIN, Role.PM_SENIOR)
  @ApiOperation({ summary: 'Submit ke Admin untuk validasi' })
  async submit(@Param('clusterId') clusterId: string, @Req() req: any) {
    const bakp = await this.bakpService.getBakp(clusterId, req.user.userId, req.user.role); // FIX
    if (!bakp) throw new NotFoundException('BAKP belum tersedia'); // FIX
    return this.bakpService.submitForValidation(bakp.id, req.user.userId, req.user.role); // FIX
  }

  @Post('validate')
  @Roles(...PERMISSIONS.BAKP_VALIDATE)
  @ApiOperation({ summary: 'Validasi Admin — setujui / tolak' })
  async validate(
    @Param('clusterId') clusterId: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string },
    @Req() req: any,
  ) {
    const bakp = await this.bakpService.getBakp(clusterId, req.user.userId, req.user.role); // FIX
    if (!bakp) throw new NotFoundException('BAKP belum tersedia'); // FIX
    return this.bakpService.validateBakp(bakp.id, body.action, body.notes, req.user.userId); // FIX
  }

  // FIX: authenticated endpoint — hand out signed, short-lived URL for bundle download
  @Get('download-url')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.GENERAL_MANAGER, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.FINANCE)
  @ApiOperation({ summary: 'Issue signed download URL (1h TTL) for BAKP bundle' })
  async getDownloadUrl(@Param('clusterId') clusterId: string) {
    const token = this.downloadTokenService.generate(clusterId, 3600);
    const apiBase =
      process.env.FILE_BASE_URL?.replace(/\/files$/, '') ||
      `http://localhost:${process.env.PORT || 3001}/api`;
    return {
      url: `${apiBase}/permit-clusters/${clusterId}/bakp/download?token=${encodeURIComponent(token)}`,
      expiresIn: 3600,
    };
  }

  @Get('download')
  @Public() // FIX: bundle link usable from email / direct navigation without Bearer token
  @ApiOperation({ summary: 'Unduh bundle BAKP final — signed token required when provided' })
  async download(
    @Param('clusterId') clusterId: string,
    @Query('token') token: string | undefined, // FIX: optional HMAC token — when present it must verify
  ) {
    if (token) {
      const valid = this.downloadTokenService.verify(token, clusterId);
      if (!valid) {
        throw new UnauthorizedException('Download link expired or invalid. Please request a new one.');
      }
    }
    return this.bakpService.resolveDownloadPublic(clusterId);
  }

  @Post(':bakpId/participants')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async addParticipant(@Param('bakpId') bakpId: string, @Body() body: { name: string; role: string; ktpNumber?: string; ktpPhotoUrl?: string }) {
    return this.bakpService.addParticipant(bakpId, body); // NEW: participant management endpoint
  }

  @Post(':bakpId/participants/:pid/delete')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async removeParticipant(@Param('bakpId') bakpId: string, @Param('pid') pid: string) {
    return this.bakpService.removeParticipant(bakpId, pid); // NEW: remove participant endpoint
  }

  @Post(':bakpId/stempel')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async stempel(@Param('bakpId') bakpId: string, @Body() body: { stempelUrl: string }) {
    return this.bakpService.uploadStempel(bakpId, body.stempelUrl); // NEW: upload stempel endpoint
  }

  // FIX: Surveyor submit BAKP for PM review
  @Post(':bakpId/field-team-submit')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT)
  async fieldTeamSubmit(@Param('clusterId') clusterId: string, @Param('bakpId') bakpId: string, @Req() req: any) {
    return this.bakpService.fieldTeamSubmit(clusterId, bakpId, req.user.userId);
  }

  // FIX: Upload single BAKP compilation document
  @Post(':bakpId/upload-doc')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT)
  async uploadDoc(
    @Param('clusterId') clusterId: string,
    @Param('bakpId') bakpId: string,
    @Body() body: { docKey: string; fileUrl: string },
    @Req() req: any,
  ) {
    return this.bakpService.uploadBakpDoc(clusterId, bakpId, body.docKey, body.fileUrl, req.user.userId);
  }

  // FIX: Toggle requiresMaterai
  @Post(':bakpId/requires-materai')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async requiresMaterai(
    @Param('clusterId') clusterId: string,
    @Param('bakpId') bakpId: string,
    @Body() body: { requiresMaterai: boolean },
  ) {
    return this.bakpService.updateRequiresMaterai(clusterId, bakpId, body.requiresMaterai);
  }

  // FIX: PM approves BAKP
  @Post(':bakpId/pm-approve')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmApprove(@Param('clusterId') clusterId: string, @Param('bakpId') bakpId: string, @Req() req: any) {
    return this.bakpService.pmApproveBakp(clusterId, bakpId, req.user.userId);
  }

  // FIX: PM rejects BAKP
  @Post(':bakpId/pm-reject')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmReject(
    @Param('clusterId') clusterId: string,
    @Param('bakpId') bakpId: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.bakpService.pmRejectBakp(clusterId, bakpId, body.reason, req.user.userId);
  }

  // FIX: Admin approves BAKP → phase 18
  @Post(':bakpId/admin-approve')
  @Roles(Role.ADMIN)
  async adminApprove(@Param('clusterId') clusterId: string, @Param('bakpId') bakpId: string, @Req() req: any) {
    return this.bakpService.adminApproveBakp(clusterId, bakpId, req.user.userId);
  }

  // FIX: Admin rejects BAKP
  @Post(':bakpId/admin-reject')
  @Roles(Role.ADMIN)
  async adminReject(
    @Param('clusterId') clusterId: string,
    @Param('bakpId') bakpId: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.bakpService.adminRejectBakp(clusterId, bakpId, body.reason, req.user.userId);
  }

  @Post(':bakpId/isp-accepted')
  @Roles(Role.ADMIN)
  async ispAccepted(@Param('clusterId') clusterId: string, @Param('bakpId') bakpId: string, @Req() req: any) {
    return this.bakpService.recordIspDecision(
      clusterId,
      bakpId,
      BakpIspDecision.ACCEPTED,
      req.user.userId,
    );
  }

  @Post(':bakpId/isp-rejected')
  @Roles(Role.ADMIN)
  async ispRejected(
    @Param('clusterId') clusterId: string,
    @Param('bakpId') bakpId: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.bakpService.recordIspDecision(
      clusterId,
      bakpId,
      BakpIspDecision.REJECTED,
      req.user.userId,
      body.reason,
    );
  }
}
