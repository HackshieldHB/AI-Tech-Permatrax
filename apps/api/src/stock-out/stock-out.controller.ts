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
  type CreateStockOutDtoType,
  type FilterStockOutDtoType,
  type RejectStockOutDtoType,
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
  @ApiOperation({ summary: 'Jumlah PENDING (badge Admin Stok)' })
  async getInboxCount(@CurrentUser() user: AuthUser) {
    const count = await this.service.getInboxCount(user.role);
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
  @ApiOperation({ summary: 'Buat permintaan ambil barang' })
  async create(
    @Body(new ZodValidationPipe(CreateStockOutDto)) dto: CreateStockOutDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Post(':id/fulfill')
  @Roles(...PERMISSIONS.STOCK_OUT_FULFILL)
  @ApiOperation({ summary: 'Penuhi permintaan (kurangi stok)' })
  async fulfill(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.fulfill(id, user.userId);
  }

  @Post(':id/reject')
  @Roles(...PERMISSIONS.STOCK_OUT_FULFILL)
  @ApiOperation({ summary: 'Tolak permintaan' })
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectStockOutDto)) dto: RejectStockOutDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, dto, user.userId);
  }
}
