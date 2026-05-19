import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  RealisasiApproveDto,
  RealisasiDraftDto,
  RealisasiRejectDto,
  type RealisasiApproveDtoType,
  type RealisasiDraftDtoType,
  type RealisasiRejectDtoType,
} from './cash-op-realisasi.dto';
import { CashOpRealisasiService } from './cash-op-realisasi.service';

const ALL_AUTH_ROLES = Object.values(Role);

@ApiTags('Cash Operation Realisasi')
@Controller('cash-operation/:id/realisasi')
export class CashOpRealisasiController {
  constructor(private readonly service: CashOpRealisasiService) {}

  @Get()
  @Roles(...ALL_AUTH_ROLES)
  @ApiOperation({ summary: 'Bundle realisasi' })
  async getBundle(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getBundle(id, user.userId, user.role);
  }

  @Post('draft')
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT)
  @ApiOperation({ summary: 'Simpan draft realisasi' })
  async saveDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RealisasiDraftDto)) dto: RealisasiDraftDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.saveDraft(id, user.userId, dto);
  }

  @Post('submit')
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT)
  @ApiOperation({ summary: 'Submit realisasi' })
  async submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user.userId);
  }

  // FIX: routes were ':cashOpId/approve-pm' which created wrong nested URL /realisasi/{id}/{cashOpId}/approve-pm
  @Post('approve-pm')
  @Roles(Role.PM_SENIOR)
  async approveByPm(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { notes?: string },
  ) {
    return this.service.approveByPm(id, user.userId, body?.notes);
  }

  @Post('reject-pm')
  @Roles(Role.PM_SENIOR)
  async rejectByPm(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    if (!body.reason?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi.');
    }
    return this.service.rejectByPm(id, user.userId, body.reason);
  }

  @Post('approve-gm')
  @Roles(Role.GENERAL_MANAGER)
  async approveByGm(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { gmSignatureUrl?: string; notes?: string },
  ) {
    return this.service.approveByGm(id, user.userId, body);
  }

  @Post('reject-gm')
  @Roles(Role.GENERAL_MANAGER)
  async rejectByGm(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    if (!body.reason?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi.');
    }
    return this.service.rejectByGm(id, user.userId, body.reason);
  }

  @Post('approve-ops')
  @Roles(Role.OPERATIONAL_MANAGER)
  async approveByOps(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { notes?: string },
  ) {
    return this.service.approveByOps(id, user.userId, body?.notes);
  }

  @Post('reject-ops')
  @Roles(Role.OPERATIONAL_MANAGER)
  async rejectByOps(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    return this.service.rejectByOps(id, user.userId, body.reason);
  }

  // FIX: route normalized to match the rest — uses :id from parent path
  @Patch('finance-review')
  @Roles(Role.FINANCE)
  async editAndApproveByFinance(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: {
      nomorRekeningFinance: string;
      financeSignatureUrl?: string;
      items?: Array<{ itemId: string; finalAmount: number }>;
      notes?: string;
    },
  ) {
    return this.service.editAndApproveByFinance(id, user.userId, dto);
  }

  @Post('reject-finance')
  @Roles(Role.FINANCE)
  async rejectByFinance(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    return this.service.rejectByFinance(id, user.userId, body.reason);
  }

  @Post('resubmit')
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT)
  async resubmitRealisasi(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RealisasiDraftDto)) dto: RealisasiDraftDtoType,
  ) {
    return this.service.resubmitRealisasi(id, user.userId, dto);
  }

  @Post('approve')
  @Roles(...PERMISSIONS.CASH_OP_REALISASI_FINANCE_APPROVE, ...PERMISSIONS.CASH_OP_REALISASI_MANAGER_APPROVE)
  @ApiOperation({ summary: 'Setujui realisasi (Marketing Head / Ops Manager / Finance)' })
  async approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RealisasiApproveDto)) dto: RealisasiApproveDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approve(id, user.userId, user.role, dto.notes, dto.hasilCheckingFinance);
  }

  @Post('reject')
  @Roles(...PERMISSIONS.CASH_OP_REALISASI_FINANCE_APPROVE, ...PERMISSIONS.CASH_OP_REALISASI_MANAGER_APPROVE)
  @ApiOperation({ summary: 'Tolak realisasi' })
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RealisasiRejectDto)) dto: RealisasiRejectDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, user.userId, user.role, dto.reason);
  }

  // Legacy approve-finance endpoint retained for frontend backward compatibility
  @Post('approve-finance')
  @Roles(...PERMISSIONS.CASH_OP_REALISASI_FINANCE_APPROVE)
  async approveFinance(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.userId, user.role, dto.notes, dto.hasilCheckingFinance);
  }
  // FIX: removed duplicate approve-gm / reject-gm legacy routes that conflicted with
  // the dedicated approveByGm / rejectByGm handlers above.
}
