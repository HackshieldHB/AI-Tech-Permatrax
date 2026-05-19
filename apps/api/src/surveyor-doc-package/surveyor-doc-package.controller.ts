import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { SurveyorDocPackageService } from './surveyor-doc-package.service';

@Controller('permit-clusters/:clusterId/doc-package')
export class SurveyorDocPackageController {
  constructor(private readonly service: SurveyorDocPackageService) {}

  @Get()
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async get(@Param('clusterId') clusterId: string, @Req() req: any) {
    return this.service.getOrCreate(clusterId, req.user.userId); // NEW: auto-refresh checklist
  }

  @Post('submit')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT)
  async submit(@Param('clusterId') clusterId: string, @Body() body: { force?: boolean }, @Req() req: any) {
    const skipPhotoCheck = process.env.NODE_ENV !== 'production' && body?.force === true; // FIX: optional non-production bypass flag
    return this.service.submit(clusterId, req.user.userId, { skipPhotoCheck }); // FIX: pass configurable photo gate behavior
  }

  @Post('pm-review')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pmReview(@Param('clusterId') clusterId: string, @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string }, @Req() req: any) {
    const pkg = await this.service.getOrCreate(clusterId, req.user.userId); // NEW: ensure package exists
    return this.service.pmReview(pkg.id, body.action, body.notes, req.user.userId); // NEW: PM decision endpoint
  }

  @Post('admin-review')
  @Roles(Role.ADMIN)
  async adminReview(@Param('clusterId') clusterId: string, @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string }, @Req() req: any) {
    const pkg = await this.service.getOrCreate(clusterId, req.user.userId); // NEW: ensure package exists
    return this.service.adminReview(pkg.id, body.action, body.notes, req.user.userId); // NEW: Admin decision endpoint
  }
}
