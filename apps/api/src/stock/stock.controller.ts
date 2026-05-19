import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { Role } from '@prisma/client';
import {
  CreateStockItemDto,
  UpdateStockItemDto,
  AdjustStockDto,
  StockFilterDto,
} from './stock.dto';

// NEW: StockController — manages material inventory catalog
@ApiTags('Stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  // NEW: GET /api/stock — paginated list with filters
  @Get()
  @Roles(...PERMISSIONS.STOCK_VIEW)
  @ApiOperation({ summary: 'List semua barang stok dengan filter' })
  async findAll(@Query() query: Record<string, any>) {
    const filters = StockFilterDto.parse(query);
    return this.stockService.findAll(filters);
  }

  // NEW: GET /api/stock/search — real-time autocomplete for order form
  @Get('search')
  @Roles(...PERMISSIONS.STOCK_VIEW)
  @ApiOperation({ summary: 'Search barang untuk autocomplete order form' })
  async search(@Query('q') q: string) {
    if (!q || q.trim().length < 1) return [];
    return this.stockService.search(q.trim());
  }

  // NEW: GET /api/stock/alerts — low stock alerts (dashboard widget)
  @Get('alerts')
  @Roles(Role.ADMIN_STOCK, Role.GENERAL_MANAGER, Role.PM_SENIOR)
  @ApiOperation({ summary: 'Daftar barang dengan stok rendah atau habis' })
  async getAlerts() {
    return this.stockService.getLowStockAlerts();
  }

  // NEW: GET /api/stock/summary — dashboard summary cards
  @Get('summary')
  @Roles(Role.ADMIN_STOCK, Role.GENERAL_MANAGER, Role.PM_SENIOR)
  @ApiOperation({ summary: 'Ringkasan total stok untuk dashboard' })
  async getSummary() {
    return this.stockService.getStockSummary();
  }

  // NEW: GET /api/stock/:id — single item with last 10 stock logs
  @Get(':id')
  @Roles(...PERMISSIONS.STOCK_VIEW)
  @ApiOperation({ summary: 'Detail satu barang + 10 riwayat mutasi terakhir' })
  async findOne(@Param('id') id: string) {
    return this.stockService.findOne(id);
  }

  // NEW: POST /api/stock — create new stock item (ADMIN_STOCK / GM)
  @Post()
  @Roles(...PERMISSIONS.STOCK_MANAGE)
  @ApiOperation({ summary: 'Tambah barang baru ke katalog' })
  async create(@Body() body: unknown, @Req() req: any) {
    const dto = CreateStockItemDto.parse(body);
    return this.stockService.create(dto, req.user.userId);
  }

  // NEW: PATCH /api/stock/:id — update item metadata (NOT qty)
  @Patch(':id')
  @Roles(...PERMISSIONS.STOCK_MANAGE)
  @ApiOperation({ summary: 'Update metadata barang (bukan jumlah stok)' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UpdateStockItemDto.parse(body);
    return this.stockService.update(id, dto, req.user.userId);
  }

  // NEW: PATCH /api/stock/:id/adjust — adjust stock quantity (creates StockLog)
  @Patch(':id/adjust')
  @Roles(...PERMISSIONS.STOCK_MANAGE)
  @ApiOperation({ summary: 'Sesuaikan jumlah stok manual — membuat catatan mutasi' })
  async adjustStock(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const raw = body as any;
    const dto = AdjustStockDto.parse({ stockItemId: id, ...raw });
    return this.stockService.adjustStock(dto, req.user.userId);
  }

  // NEW: DELETE /api/stock/:id — soft delete (GM only)
  @Delete(':id')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Nonaktifkan barang dari katalog (soft delete)' })
  async softDelete(@Param('id') id: string) {
    return this.stockService.softDelete(id);
  }
}
