import { Controller, Get, Post, Patch, Body, Param, Req, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkomBudgetService } from './skom-budget.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('SKOM Budget')
@Controller('permit-clusters/:clusterId/skom-budget')
export class SkomBudgetController {
  constructor(private readonly skom: SkomBudgetService) {}

  @Get()
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.GENERAL_MANAGER, Role.OPERATIONAL_MANAGER, Role.FINANCE
  )
  async get(@Param('clusterId') clusterId: string) {
    return this.skom.getByCluster(clusterId);
  }

  @Post()
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, // FIX: PM submits SKOM
    Role.ADMIN,
  )
  async create(
    @Param('clusterId') clusterId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.skom.create(clusterId, body, req.user.userId);
  }

  @Patch(':id')
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, // FIX: PM can update
    Role.ADMIN,
  )
  async update(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.skom.update(id, body, req.user.userId);
  }

  @Post(':id/submit')
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, // FIX: PM submits for Ops review
    Role.ADMIN,
  )
  async submitForApproval(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.skom.submitForApproval(id, req.user.userId);
  }

  // POST ops-review
  @Post(':id/ops-review')
  @Roles(Role.OPERATIONAL_MANAGER)
  async opsReview(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string },
    @Req() req: any,
  ) {
    return this.skom.opsReview(id, body, req.user.userId);
  }

  // POST gm-review
  @Post(':id/gm-review')
  @Roles(Role.GENERAL_MANAGER)
  async gmReview(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string },
    @Req() req: any,
  ) {
    return this.skom.gmReview(id, body, req.user.userId);
  }

  @Post('disbursements')
  @Roles(Role.OPERATIONAL_MANAGER, Role.PM_SENIOR, Role.GENERAL_MANAGER)
  async addDisbursement(
    @Param('clusterId') clusterId: string,
    @Body() body: { amount: string; description: string; scheduledDate: string; evidenceUrl?: string },
    @Req() req: any,
  ) {
    const b = await this.skom.getByCluster(clusterId);
    if (!b) throw new NotFoundException('SKOM belum ada');
    return this.skom.addDisbursement(clusterId, body, req.user.userId);
  }

  @Get('disbursements')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.OPERATIONAL_MANAGER, Role.GENERAL_MANAGER, Role.ADMIN)
  async listDisbursements(@Param('clusterId') clusterId: string) {
    return this.skom.getDisbursementSchedule(clusterId);
  }

  // POST /permit-clusters/:clusterId/skom-budget/:id/disburse
  @Post(':id/disburse')
  @Roles(Role.OPERATIONAL_MANAGER) // FIX: only Ops Manager
  async scheduleDisbursement(
    @Param('clusterId') clusterId: string,
    @Param('id') id: string,
    @Body() body: {
      disbursementStartDate: string;
      disbursementEndDate:   string;
      disbursementAmount:    number;
      disbursementNotes?:    string;
    },
    @Req() req: any,
  ) {
    const skom = await this.skom.getByCluster(clusterId);
    if (!skom || skom.id !== id) {
      throw new NotFoundException('SKOM Budget not found');
    }
    return this.skom.addDisbursementSchedule(id, body, req.user.userId);
  }
}
