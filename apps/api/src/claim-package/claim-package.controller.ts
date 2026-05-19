import { Controller, Get, Post, Body, Param, Req, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClaimPackageService } from './claim-package.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Claim Package')
@Controller('permit-clusters/:clusterId/claim-package')
export class ClaimPackageController {
  constructor(private readonly claim: ClaimPackageService) {}

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
    Role.FINANCE,
  ) // FIX: Surveyor needs claim package in phase 18
  async get(@Param('clusterId') clusterId: string) {
    return this.claim.findByCluster(clusterId);
  }

  @Post('init')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async init(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.claim.initClaimPackage(clusterId, req.user.userId);
  }

  @Post(':id/compile')
  @Roles(Role.ADMIN, Role.PM_SENIOR)
  async compile(@Param('clusterId') clusterId: string, @Param('id') id: string, @Req() req: any) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    return this.claim.compilePackage(id, req.user.userId);
  }

  @Post(':id/approve')
  @Roles(Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN)
  async approve(@Param('clusterId') clusterId: string, @Param('id') id: string, @Req() req: any) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    return this.claim.approve(id, req.user.userId);
  }

  @Post(':id/reject')
  @Roles(Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN)
  async reject(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    return this.claim.reject(id, body.reason, req.user.userId);
  }

  @Post(':id/admin-approve-doc')
  @Roles(Role.ADMIN)
  async adminApproveDoc(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { docKey: string },
    @Req() req: any,
  ) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    const result = await this.claim.adminApproveDoc(id, body.docKey, req.user.userId);
    await this.claim.checkAllApprovedAndAdvance(id);
    return result;
  }

  @Post(':id/admin-reject-doc')
  @Roles(Role.ADMIN)
  async adminRejectDoc(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { docKey: string; notes: string },
    @Req() req: any,
  ) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    return this.claim.adminRejectDoc(id, body.docKey, body.notes, req.user.userId);
  }

  @Post(':id/pm-approve-doc')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmApproveDoc(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { docKey: string },
    @Req() req: any,
  ) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    const result = await this.claim.pmApproveDoc(id, body.docKey, req.user.userId);
    await this.claim.checkAllApprovedAndAdvance(id);
    return result;
  }

  @Post(':id/pm-reject-doc')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmRejectDoc(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { docKey: string; notes: string },
    @Req() req: any,
  ) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    return this.claim.pmRejectDoc(id, body.docKey, body.notes, req.user.userId);
  }

  @Post(':id/reupload-doc')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT)
  async reUploadDoc(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { docKey: string; fileUrl: string; stream: 'A' | 'B' },
    @Req() req: any,
  ) {
    const row = await this.claim.findByCluster(clusterId);
    if (!row || row.id !== id) throw new NotFoundException('Claim tidak ada');
    if (!body.stream || (body.stream !== 'A' && body.stream !== 'B')) {
      throw new BadRequestException('stream harus A atau B');
    }
    return this.claim.reUploadDoc(id, body.docKey, body.fileUrl, body.stream, req.user.userId);
  }

  @Post('stream-a')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async streamA(@Param('clusterId') clusterId: string, @Body() body: { docKey: string; fileUrl: string }) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.addStreamADoc(row.id, body.docKey, body.fileUrl); // FIX: stream A upload endpoint compatible with e2e route
  }

  @Post('stream-b')
  @Roles(Role.ADMIN)
  async streamB(@Param('clusterId') clusterId: string, @Body() body: { docKey: string; fileUrl: string }) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.addStreamBDoc(row.id, body.docKey, body.fileUrl); // FIX: stream B upload endpoint compatible with e2e route
  }

  @Post('check1')
  @Roles(Role.ADMIN)
  async check1(@Param('clusterId') clusterId: string) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.runCheck1(row.id); // FIX: run check1 via cluster route
  }

  @Post('submit-check2')
  @Roles(Role.ADMIN)
  async submitCheck2(@Param('clusterId') clusterId: string) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.adminSubmitForCheck2(row.id); // FIX: submit package for PM check2 via cluster route
  }

  @Post('pm-approve-check2')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmApproveCheck2(@Param('clusterId') clusterId: string, @Req() req: any) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.pmApproveCheck2(row.id, req.user.userId); // FIX: PM approve check2 via cluster route
  }

  @Post('pm-reject-check2')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmRejectCheck2(@Param('clusterId') clusterId: string, @Body() body: { notes: string }, @Req() req: any) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.pmRejectCheck2(row.id, req.user.userId, body.notes); // FIX: PM reject check2 via cluster route
  }

  @Post('submit-to-isp')
  @Roles(Role.ADMIN)
  async submitToIsp(@Param('clusterId') clusterId: string, @Req() req: any) {
    const row = await this.claim.findByCluster(clusterId); // FIX: resolve package by cluster-scoped route
    if (!row) throw new NotFoundException('Claim tidak ada');
    return this.claim.submitToIsp(row.id, req.user.userId); // FIX: final submit to ISP via cluster route
  }
}
