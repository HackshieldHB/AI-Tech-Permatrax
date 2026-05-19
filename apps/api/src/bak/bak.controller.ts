import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common'; // FIX
import { ApiTags, ApiOperation } from '@nestjs/swagger'; // FIX
import { CompensationService } from '../compensation/compensation.service'; // FIX
import { SignatureService } from '../signature/signature.service'; // FIX
import { BakAgreementService } from './bak.service'; // FIX
import { Roles } from '../auth/decorators/roles.decorator'; // FIX
import { PERMISSIONS } from '../auth/permissions'; // FIX
import { Role } from '@prisma/client'; // FIX

/** FIX: Surveyor BAK form + PDF pipeline under /permit-clusters/:id/bak */
@ApiTags('BAK Agreement')
@Controller('permit-clusters')
export class PermitClusterBakFormController {
  constructor(private readonly bakAgreementService: BakAgreementService) {} // FIX

  @Get(':id/bak') // FIX
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
  ) // FIX
  @ApiOperation({ summary: 'Get or init surveyor BAK agreement for cluster' }) // FIX
  async get(@Param('id') clusterId: string, @Req() req: any) {
    return this.bakAgreementService.getOrInit(clusterId, req.user.userId); // FIX
  }

  @Post(':id/bak/save-form') // FIX
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT) // FIX
  @ApiOperation({ summary: 'Save draft BAK agreement fields' }) // FIX
  async saveForm(
    @Param('id') clusterId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    return this.bakAgreementService.saveForm(clusterId, body, req.user.userId); // FIX
  }

  @Post(':id/bak/complete') // FIX
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT) // FIX
  @ApiOperation({ summary: 'Finalize form and generate BAK PDF' }) // FIX
  async complete(@Param('id') clusterId: string, @Req() req: any) {
    return this.bakAgreementService.completeForm(clusterId, req.user.userId); // FIX
  }

  @Get(':id/bak/download-pdf') // FIX
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
  ) // FIX
  @ApiOperation({ summary: 'JSON { url } for authenticated SPA download' }) // FIX
  async downloadPdf(@Param('id') clusterId: string, @Req() req: any) {
    return this.bakAgreementService.getPdfUrl(clusterId, req.user.userId); // FIX
  }

  @Post(':id/bak/upload-signed') // FIX
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT) // FIX
  @ApiOperation({ summary: 'Upload signed BAK PDF URL' }) // FIX
  async uploadSigned(
    @Param('id') clusterId: string,
    @Body() body: { signedPdfUrl: string },
    @Req() req: any,
  ) {
    return this.bakAgreementService.uploadSignedBak(
      clusterId,
      body.signedPdfUrl,
      req.user.userId,
    ); // FIX
  }

  @Post(':id/bak/pm-approve') // FIX
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR) // FIX
  @ApiOperation({ summary: 'PM approve surveyor BAK' }) // FIX
  async pmApprove(@Param('id') clusterId: string, @Req() req: any) {
    return this.bakAgreementService.pmApprove(clusterId, req.user.userId); // FIX
  }

  @Post(':id/bak/pm-reject') // FIX
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR) // FIX
  @ApiOperation({ summary: 'PM reject surveyor BAK' }) // FIX
  async pmReject(
    @Param('id') clusterId: string,
    @Body() body: { notes: string },
    @Req() req: any,
  ) {
    return this.bakAgreementService.pmReject(clusterId, body.notes, req.user.userId); // FIX
  }

  @Post(':id/bak/admin-approve') // FIX
  @Roles(Role.ADMIN) // FIX
  @ApiOperation({ summary: 'Admin approve surveyor BAK and advance phase' }) // FIX
  async adminApprove(@Param('id') clusterId: string, @Req() req: any) {
    return this.bakAgreementService.adminApprove(clusterId, req.user.userId); // FIX
  }

  @Post(':id/bak/admin-reject') // FIX
  @Roles(Role.ADMIN) // FIX
  @ApiOperation({ summary: 'Admin reject surveyor BAK' }) // FIX
  async adminReject(
    @Param('id') clusterId: string,
    @Body() body: { notes: string },
    @Req() req: any,
  ) {
    return this.bakAgreementService.adminReject(clusterId, body.notes, req.user.userId); // FIX
  }
}

/** NEW: single entry for /bak/* to avoid duplicate @Controller('bak') registration */
@ApiTags('BAK')
@Controller('bak')
export class BakController {
  constructor(
    private readonly compensationService: CompensationService,
    private readonly signatureService: SignatureService,
  ) {}

  @Post(':bakId/approve')
  @Roles(...PERMISSIONS.BAK_APPROVE)
  @ApiOperation({ summary: 'Setujui / tolak BAK' })
  async approve(
    @Param('bakId') bakId: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string },
    @Req() req: any,
  ) {
    return this.compensationService.approveBak(bakId, body.action, body.notes, req.user.userId);
  }

  @Get(':bakId/signatures')
  @Roles(...PERMISSIONS.SIGNATURE_VALIDATE, ...PERMISSIONS.SIGNATURE_UPLOAD)
  @ApiOperation({ summary: 'Daftar tanda tangan' })
  async listSigs(@Param('bakId') bakId: string) {
    return this.signatureService.getSignaturesForBak(bakId);
  }

  @Post(':bakId/signatures')
  @Roles(...PERMISSIONS.SIGNATURE_UPLOAD)
  @ApiOperation({ summary: 'Unggah data penandatangan' })
  async addSig(
    @Param('bakId') bakId: string,
    @Body()
    body: {
      signatoryName: string;
      signatoryNik: string;
      signatoryRole: string;
      ktpPhotoUrl?: string;
      signatureUrl?: string;
      hasStamp?: boolean;
    },
    @Req() req: any,
  ) {
    return this.signatureService.addSignature(bakId, body, req.user.userId);
  }
}
