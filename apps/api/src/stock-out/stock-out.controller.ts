import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StockOutService } from './stock-out.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';
import {
  CreateStockOutDto,
  FilterStockOutDto,
  RejectStockOutDto,
  AdminStockApproveDto,
  ReturnForRevisionDto,
  type CreateStockOutDtoType,
  type FilterStockOutDtoType,
  type RejectStockOutDtoType,
  type AdminStockApproveDtoType,
  type ReturnForRevisionDtoType,
} from './stock-out.dto';

@ApiTags('Stock Out')
@Controller('stock-out')
export class StockOutController {
  constructor(private readonly service: StockOutService) {}

  @Get()
  @Roles(...PERMISSIONS.STOCK_OUT_VIEW)
  @ApiOperation({ summary: 'Daftar permintaan stock out' })
  async findAll(
    @Query(new ZodValidationPipe(FilterStockOutDto)) filter: FilterStockOutDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(filter, user.userId, user.role);
  }

  @Get('inbox-count')
  @Roles(...PERMISSIONS.STOCK_OUT_VIEW)
  @ApiOperation({ summary: 'Jumlah request di inbox role saat ini' })
  async getInboxCount(@CurrentUser() user: AuthUser) {
    const count = await this.service.getInboxCount(user.userId, user.role);
    return { count };
  }

  @Get(':id')
  @Roles(...PERMISSIONS.STOCK_OUT_VIEW)
  @ApiOperation({ summary: 'Detail stock out' })
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.userId, user.role);
  }

  @Post()
  @Roles(...PERMISSIONS.STOCK_OUT_REQUEST)
  @ApiOperation({ summary: 'Buat permintaan ambil barang (PM)' })
  async create(
    @Body(new ZodValidationPipe(CreateStockOutDto)) dto: CreateStockOutDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Post(':id/resubmit')
  @Roles(...PERMISSIONS.STOCK_OUT_REQUEST)
  @ApiOperation({ summary: 'Revisi dan kirim ulang request DRAFT (PM)' })
  async resubmit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateStockOutDto)) dto: CreateStockOutDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resubmit(id, dto, user.userId);
  }

  @Post(':id/admin-approve')
  @Roles(...PERMISSIONS.STOCK_OUT_FULFILL)
  @ApiOperation({ summary: 'Admin Stock approve + isi DO Number' })
  async adminStockApprove(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminStockApproveDto)) dto: AdminStockApproveDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.adminStockApprove(id, dto, user.userId);
  }

  @Post(':id/admin-return')
  @Roles(...PERMISSIONS.STOCK_OUT_FULFILL)
  @ApiOperation({ summary: 'Admin Stock kembalikan ke PM untuk revisi' })
  async adminStockReturn(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReturnForRevisionDto)) dto: ReturnForRevisionDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.adminStockReturn(id, dto, user.userId);
  }

  @Post(':id/pm-confirm')
  @Roles(...PERMISSIONS.STOCK_OUT_REQUEST)
  @ApiOperation({ summary: 'PM konfirmasi approval Admin Stock' })
  async pmConfirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.pmConfirm(id, user.userId);
  }

  @Post(':id/pm-return')
  @Roles(...PERMISSIONS.STOCK_OUT_REQUEST)
  @ApiOperation({ summary: 'PM kembalikan ke Admin Stock untuk perbaikan' })
  async pmReturn(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReturnForRevisionDto)) dto: ReturnForRevisionDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.pmReturn(id, dto, user.userId);
  }

  @Post(':id/finance-approve')
  @Roles(...PERMISSIONS.STOCK_OUT_FINANCE)
  @ApiOperation({ summary: 'Finance approve → kurangi stok + generate Surat Jalan' })
  async financeApprove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.financeApprove(id, user.userId);
  }

  @Post(':id/finance-return')
  @Roles(...PERMISSIONS.STOCK_OUT_FINANCE)
  @ApiOperation({ summary: 'Finance kembalikan ke PM untuk revisi' })
  async financeReturn(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReturnForRevisionDto)) dto: ReturnForRevisionDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.financeReturn(id, dto, user.userId);
  }

  @Post(':id/reject')
  @Roles(...PERMISSIONS.STOCK_OUT_FULFILL)
  @ApiOperation({ summary: 'Hard reject (admin override)' })
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectStockOutDto)) dto: RejectStockOutDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, dto, user.userId);
  }

  // Legacy endpoint — kept for backward compat, now routes to adminStockApprove
  @Post(':id/fulfill')
  @Roles(...PERMISSIONS.STOCK_OUT_FULFILL)
  @ApiOperation({ summary: 'Legacy: Admin Stock approve (redirects to admin-approve without DO#)' })
  async fulfill(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.adminStockApprove(id, { doNumber: 'LEGACY' }, user.userId);
  }
}
