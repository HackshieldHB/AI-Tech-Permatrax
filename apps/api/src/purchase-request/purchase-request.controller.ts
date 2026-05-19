import { Controller, Get, Patch, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PurchaseRequestService } from './purchase-request.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  UpdatePurchaseRequestStatusDto,
  UpdatePurchaseRequestItemsDto,
  PurchaseRequestListFilterDto,
} from './purchase-request.dto';

@ApiTags('Purchase Requests')
@Controller('purchase-requests')
export class PurchaseRequestController {
  constructor(private readonly purchaseRequestService: PurchaseRequestService) {}

  @Get()
  @Roles(...PERMISSIONS.PURCHASE_REQUEST_VIEW)
  @ApiOperation({ summary: 'Daftar permintaan pembelian + pendingCount (Finance badge)' })
  async findAll(@Query() query: Record<string, unknown>, @Req() req: any) {
    const filters = PurchaseRequestListFilterDto.parse(query);
    return this.purchaseRequestService.findAll(filters, req.user.userId, req.user.role);
  }

  @Get('inbox-count')
  @Roles(Role.FINANCE, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Jumlah PR PENDING untuk badge Finance' })
  async inboxCount() {
    return this.purchaseRequestService.getFinanceInboxCount();
  }

  @Get(':id')
  @Roles(...PERMISSIONS.PURCHASE_REQUEST_VIEW)
  @ApiOperation({ summary: 'Detail satu permintaan pembelian' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.purchaseRequestService.findOne(id, req.user.userId, req.user.role);
  }

  @Patch(':id/status')
  @Roles(...PERMISSIONS.PURCHASE_REQUEST_PROCESS)
  @ApiOperation({ summary: 'Finance ubah status PR' })
  async updateStatus(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UpdatePurchaseRequestStatusDto.parse(body);
    return this.purchaseRequestService.updateStatus(
      id,
      dto.status,
      dto.notes,
      req.user.userId,
    );
  }

  @Patch(':id/items')
  @Roles(...PERMISSIONS.PURCHASE_REQUEST_PROCESS)
  @ApiOperation({ summary: 'Finance sesuaikan harga satuan per baris' })
  async updateItems(@Param('id') id: string, @Body() body: unknown) {
    const dto = UpdatePurchaseRequestItemsDto.parse(body);
    return this.purchaseRequestService.updateItemPrices(
      id,
      dto.items.map((i) => ({ itemId: i.itemId, unitPrice: i.unitPrice })),
    );
  }
}
