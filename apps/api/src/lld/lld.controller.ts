import { Controller, Get, Post, Patch, Body, Param, Req, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LldService } from './lld.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('LLD')
@Controller('permit-clusters/:clusterId/lld')
export class LldController {
  constructor(private readonly lldService: LldService) {}

  @Get()
  @Roles( // FIX Fix 1: every actor in the Designer → PM → Admin → ISP chain must be able to view the LLD
    Role.DESIGNER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
    Role.OPERATIONAL_MANAGER,
  )
  async get(@Param('clusterId') clusterId: string) {
    return this.lldService.getByCluster(clusterId);
  }

  @Post()
  @Roles( // FIX Fix 1: Designer is the PRIMARY uploader; PM/Admin retained as fallback per spec
    Role.DESIGNER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: { apdFileUrl?: string; schematicFileUrl?: string; coreConnectionUrl?: string; additionalFiles?: string[] },
    @Req() req: any,
  ) {
    return this.lldService.create(clusterId, body, req.user.userId);
  }

  @Patch(':lldId')
  @Roles( // FIX Fix 1: Designer can update files before submit; PM/Admin can patch for corrections
    Role.DESIGNER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async patch(
    @Param('lldId') lldId: string,
    @Body()
    body: { apdFileUrl?: string; schematicFileUrl?: string; coreConnectionUrl?: string; additionalFiles?: string[] },
    @Req() req: any,
  ) {
    return this.lldService.update(lldId, body, req.user.userId);
  }

  @Post(':lldId/submit')
  @Roles( // FIX Fix 1: Designer submits to PM; PM may also submit on fallback paths
    Role.DESIGNER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
  )
  async submitForReview(@Param('lldId') lldId: string, @Req() req: any) {
    return this.lldService.submit(lldId, req.user.userId); // FIX Fix 1: route /submit to SUBMITTED_FOR_REVIEW flow (not direct to ISP)
  }

  @Post(':lldId/submit-to-isp')
  @Roles(Role.ADMIN) // FIX Fix 1: only Admin may push LLD directly to ISP (legacy path, prefer admin-approve)
  async submit(@Param('clusterId') clusterId: string, @Param('lldId') lldId: string, @Req() req: any) {
    const l = await this.lldService.getByCluster(clusterId);
    if (!l || l.id !== lldId) throw new BadRequestException('LLD tidak cocok');
    return this.lldService.submitToIsp(lldId, req.user.userId);
  }

  @Post(':lldId/isp-decision')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.GENERAL_MANAGER) // FIX Fix 1: Admin records ISP decision; PM_SENIOR/GM as overrides
  async decision(
    @Param('clusterId') clusterId: string,
    @Param('lldId') lldId: string,
    @Body() body: { action: 'APPROVE' | 'REVISE'; feedback?: string },
    @Req() req: any,
  ) {
    const l = await this.lldService.getByCluster(clusterId);
    if (!l || l.id !== lldId) throw new BadRequestException('LLD tidak cocok');
    return this.lldService.recordIspDecision(lldId, body.action, body.feedback, req.user.userId);
  }

  @Post(':lldId/pm-approve')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR) // FIX Fix 1: PM approves after Designer submits → hands off to Admin
  async pmApprove(@Param('lldId') lldId: string, @Req() req: any) {
    return this.lldService.pmApprove(lldId, req.user.userId);
  }

  @Post(':lldId/pm-reject')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmReject(
    @Param('clusterId') clusterId: string,
    @Param('lldId') lldId: string,
    @Body() body: { notes?: string },
    @Req() req: any,
  ) {
    const l = await this.lldService.getByCluster(clusterId); // FIX: validasi cluster
    if (!l || l.id !== lldId) throw new BadRequestException('LLD tidak cocok'); // FIX
    return this.lldService.pmReject(lldId, body.notes ?? '', req.user.userId); // FIX
  }

  @Post(':lldId/admin-approve')
  @Roles(Role.ADMIN) // FIX Fix 1: Admin is the sole actor for sending LLD to ISP (PENDING_ISP)
  async adminApprove(@Param('lldId') lldId: string, @Req() req: any) {
    return this.lldService.adminApprove(lldId, req.user.userId);
  }

  @Post(':lldId/admin-reject')
  @Roles(Role.ADMIN)
  async adminReject(
    @Param('clusterId') clusterId: string,
    @Param('lldId') lldId: string,
    @Body() body: { notes?: string },
    @Req() req: any,
  ) {
    const l = await this.lldService.getByCluster(clusterId); // FIX: pastikan LLD milik cluster ini
    if (!l || l.id !== lldId) throw new BadRequestException('LLD tidak cocok'); // FIX
    return this.lldService.adminReject(lldId, body.notes ?? '', req.user.userId); // FIX
  }
}
