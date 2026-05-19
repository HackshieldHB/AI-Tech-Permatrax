import { Controller, Get, Post, Patch, Body, Param, Req, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HldService } from './hld.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('HLD')
@Controller('permit-clusters/:clusterId/hld')
export class HldController {
  constructor(private readonly hldService: HldService) {}

  @Get()
  @Roles( // FIX 3: include OPERATIONAL_MANAGER for read-only HLD visibility
    Role.DESIGNER, // FIX Issue 10: designer must read HLD state
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
    Role.OPERATIONAL_MANAGER,
  )
  async get(@Param('clusterId') clusterId: string) {
    return this.hldService.getByCluster(clusterId);
  }

  @Post()
  @Roles(Role.DESIGNER, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN) // FIX Issue 10: designer uploads HLD
  async create(
    @Param('clusterId') clusterId: string,
    @Body() body: { kmzFileUrl?: string; boqFileUrl?: string; additionalFiles?: string[] },
    @Req() req: any,
  ) {
    return this.hldService.create(clusterId, body, req.user.userId);
  }

  @Patch(':hldId')
  @Roles(Role.DESIGNER, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN) // FIX Issue 10: designer edits HLD
  async patch(
    @Param('hldId') hldId: string,
    @Body() body: { kmzFileUrl?: string; boqFileUrl?: string; additionalFiles?: string[] },
    @Req() req: any,
  ) {
    return this.hldService.update(hldId, body, req.user.userId, req.user.role);
  }

  @Post(':hldId/submit')
  @Roles(Role.DESIGNER, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR) // FIX Issue 10: designer submits HLD for PM review
  async submitForReview(@Param('hldId') hldId: string, @Req() req: any) {
    return this.hldService.submit(hldId, req.user.userId); // FIX: explicit HLD submit route for review chain
  }

  @Post(':hldId/submit-to-isp')
  @Roles(Role.ADMIN)
  async submit(@Param('clusterId') clusterId: string, @Param('hldId') hldId: string, @Req() req: any) {
    const h = await this.hldService.getByCluster(clusterId);
    if (!h || h.id !== hldId) throw new BadRequestException('HLD tidak cocok');
    return this.hldService.submitToIsp(hldId, req.user.userId);
  }

  @Post(':hldId/isp-decision')
  @Roles(Role.PM_SENIOR, Role.GENERAL_MANAGER, Role.ADMIN)
  async decision(
    @Param('clusterId') clusterId: string,
    @Param('hldId') hldId: string,
    @Body() body: { action: 'APPROVE' | 'REVISE'; feedback?: string },
    @Req() req: any,
  ) {
    const h = await this.hldService.getByCluster(clusterId);
    if (!h || h.id !== hldId) throw new BadRequestException('HLD tidak cocok');
    return this.hldService.recordIspDecision(hldId, body.action, body.feedback, req.user.userId);
  }

  @Post(':hldId/pm-approve')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmApprove(@Param('hldId') hldId: string, @Req() req: any) {
    return this.hldService.pmApprove(hldId, req.user.userId); // NEW: PM approve endpoint
  }

  @Post(':hldId/pm-reject')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmReject(@Param('hldId') hldId: string, @Body() body: { notes?: string }, @Req() req: any) {
    return this.hldService.pmReject(hldId, body.notes, req.user.userId); // FIX: pass actor for service
  }

  @Post(':hldId/admin-approve')
  @Roles(Role.ADMIN)
  async adminApprove(@Param('hldId') hldId: string, @Req() req: any) {
    return this.hldService.adminApprove(hldId, req.user.userId); // NEW: Admin approve endpoint
  }

  @Post(':hldId/admin-reject')
  @Roles(Role.ADMIN)
  async adminReject(@Param('hldId') hldId: string, @Body() body: { notes?: string }, @Req() req: any) {
    return this.hldService.adminReject(hldId, body.notes, req.user.userId); // FIX: pass actor
  }
}
