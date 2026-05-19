import { Controller, Get, Post, Patch, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ContractService } from './contract.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractStatus, ContractType, Role } from '@prisma/client';

@ApiTags('Contract')
@Controller('permit-clusters/:clusterId/contract')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  // ─────────────────────────────────────────────
  // FIX PR/BR→PO flow: NEW combined workflow endpoints (used by pipeline [id]/page.tsx)
  // ─────────────────────────────────────────────

  // FIX PR/BR→PO flow: return the single workflow row (PrBrWorkflow) for the cluster
  @Get()
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.GENERAL_MANAGER, Role.OPERATIONAL_MANAGER,
  )
  @ApiOperation({ summary: 'Get PR/BR→PO workflow for cluster (single row)' })
  async getWorkflow(@Param('clusterId') clusterId: string) {
    const workflow = await this.contractService.getWorkflowByCluster(clusterId);
    return workflow ?? null; // FIX: 200 + null body — frontend can auto-init without treating as HTTP error
  }

  // FIX: manual init for clusters already in PR_BR_ISSUANCE that missed the automatic trigger
  @Post('init')
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Initialize PR/BR workflow row if missing (recovery)' })
  async initWorkflow(@Param('clusterId') clusterId: string) {
    return this.contractService.initPrBrForCluster(clusterId);
  }

  // FIX PR/BR→PO flow: PM or Admin uploads PR (required) + BR (optional)
  @Post('upload-prbr')
  @Roles(
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Upload PR/BR documents from ISP (PM or Admin)' })
  async uploadPrBr(
    @Param('clusterId') clusterId: string,
    @Body() body: { prFileUrl: string; brFileUrl?: string; prBrNotes?: string },
    @Req() req: any,
  ) {
    return this.contractService.uploadPrBr(clusterId, body, req.user.userId);
  }

  // FIX PR/BR→PO flow: Admin reviews PR/BR (APPROVE advances to CONTRACT_MANAGEMENT)
  @Post('admin-review')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin approves/rejects PR/BR upload' })
  async adminReview(
    @Param('clusterId') clusterId: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string },
    @Req() req: any,
  ) {
    return this.contractService.adminReviewPrBr(clusterId, body, req.user.userId);
  }

  // FIX PR/BR→PO flow: Admin uploads PO document after PR/BR approved
  @Post('create-po')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin creates PO document (after PR/BR approved)' })
  async createPo(
    @Param('clusterId') clusterId: string,
    @Body() body: { poFileUrl: string; poNotes?: string },
    @Req() req: any,
  ) {
    return this.contractService.createPo(clusterId, body, req.user.userId);
  }

  // FIX PR/BR→PO flow: Ops Manager approves/rejects PO (APPROVE advances to SKOM_BUDGET)
  @Post('ops-review')
  @Roles(Role.OPERATIONAL_MANAGER)
  @ApiOperation({ summary: 'Ops Manager approves/rejects PO' })
  async opsReview(
    @Param('clusterId') clusterId: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; notes?: string },
    @Req() req: any,
  ) {
    return this.contractService.opsReviewPo(clusterId, body, req.user.userId);
  }

  // ─────────────────────────────────────────────
  // LEGACY ContractRecord endpoints — kept for backward compatibility
  // ─────────────────────────────────────────────

  // FIX PR/BR→PO flow: legacy list endpoint renamed to /records so the new GET / returns the workflow
  @Get('records')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  async list(@Param('clusterId') clusterId: string) {
    return this.contractService.findAll(clusterId);
  }

  @Post()
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      type: ContractType;
      contractNumber?: string;
      vendor?: string;
      amount?: string;
      startDate?: string;
      endDate?: string;
      fileUrl?: string;
      notes?: string;
    },
    @Req() req: any,
  ) {
    return this.contractService.create(clusterId, body, req.user.userId);
  }

  @Patch(':id/status')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  async status(@Param('id') id: string, @Body() body: { status: ContractStatus }, @Req() req: any) {
    return this.contractService.updateStatus(id, body.status, req.user.userId);
  }

  @Post(':id/ops-approve')
  @Roles(Role.OPERATIONAL_MANAGER)
  async opsApprove(@Param('id') id: string, @Req() req: any) {
    return this.contractService.opsManagerApprove(id, req.user.userId); // NEW: Ops manager approval
  }

  @Post(':id/gm-approve')
  @Roles(Role.GENERAL_MANAGER)
  async gmApprove(@Param('id') id: string, @Req() req: any) {
    return this.contractService.gmApprove(id, req.user.userId); // NEW: GM approval
  }

  @Post(':id/reject')
  @Roles(Role.OPERATIONAL_MANAGER, Role.GENERAL_MANAGER)
  async reject(@Param('id') id: string, @Body() body: { notes: string }, @Req() req: any) {
    return this.contractService.reject(id, body.notes, req.user.userId); // NEW: rejection endpoint
  }
}
