import {
  Controller, Get, Post, Body, Param, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OrderService } from './order.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  CreateOrderDto,
  CreateApprovalOrderDto,
  OrderFilterDto,
  CreateRestockOrderDto,
  CancelOrderDto,
  FinanceProcessDto,
} from './order.dto';
import type { CreateRestockOrderDtoType, CancelOrderDtoType, FinanceProcessDtoType } from './order.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PoGenerationService } from '../po-generation/po-generation.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly poGeneration: PoGenerationService,
  ) {}

  @Get()
  @Roles(...PERMISSIONS.ORDER_VIEW)
  @ApiOperation({ summary: 'List order barang (role-aware)' })
  async findAll(@Query() query: Record<string, unknown>, @Req() req: any) {
    const filters = OrderFilterDto.parse(query);
    return this.orderService.findAll(filters, req.user.userId, req.user.role);
  }

  @Post()
  @Roles(...PERMISSIONS.ORDER_CREATE)
  @ApiOperation({ summary: 'PM: draft katalog ATAU pengajuan approval (requestedItems)' })
  async create(@Body() body: unknown, @Req() req: any) {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b?.requestedItems) && !Array.isArray(b?.items)) {
      const dto = CreateApprovalOrderDto.parse(body);
      return this.orderService.createApprovalOrder(dto, req.user.userId);
    }
    const dto = CreateOrderDto.parse(body);
    return this.orderService.create(dto, req.user.userId);
  }

  @Post('restock')
  @Roles(...PERMISSIONS.ORDER_CREATE_RESTOCK)
  @ApiOperation({ summary: 'Admin Stock: buat order restock gudang (STOCK_RESTOCK)' })
  async createRestock(
    @Body(new ZodValidationPipe(CreateRestockOrderDto)) dto: CreateRestockOrderDtoType,
    @Req() req: any,
  ) {
    return this.orderService.createRestock(dto, req.user.userId);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.ORDER_VIEW)
  @ApiOperation({ summary: 'Detail satu order barang' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.orderService.findOne(id, req.user.userId, req.user.role);
  }

  @Post(':id/submit')
  @Roles(...PERMISSIONS.ORDER_CREATE)
  @ApiOperation({ summary: 'Submit order DRAFT — pengecekan stok / Surat Jalan' })
  async submit(@Param('id') id: string, @Req() req: any) {
    return this.orderService.submit(id, req.user.userId, req.user.role);
  }

  @Post(':id/admin-stock-submit')
  @Roles(Role.ADMIN_STOCK)
  @ApiOperation({ summary: 'Admin Stok isi harga — lanjut ke Purchasing (M3)' })
  async adminStockSubmit(
    @Param('id') id: string,
    @Body()
    body: {
      purchaseItems: {
        name: string;
        quantity: number;
        unit: string;
        unitPrice: number;
        totalPrice: number;
        notes?: string;
      }[];
      adminStockNotes?: string;
    },
    @Req() req: any,
  ) {
    return this.orderService.adminStockSubmit(id, body, req.user.userId);
  }

  @Post(':id/ops-approve')
  @Roles(Role.OPERATIONAL_MANAGER)
  @ApiOperation({ summary: 'Ops approve → GM' })
  async opsApprove(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Req() req: any,
  ) {
    return this.orderService.opsApprove(id, body, req.user.userId);
  }

  @Post(':id/ops-reject')
  @Roles(Role.OPERATIONAL_MANAGER)
  @ApiOperation({ summary: 'Ops reject' })
  async opsReject(
    @Param('id') id: string,
    @Body() body: { notes: string },
    @Req() req: any,
  ) {
    return this.orderService.opsReject(id, body, req.user.userId);
  }

  @Post(':id/gm-approve')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'GM approve — potong budget, menunggu pembayaran Finance' })
  async gmApprove(
    @Param('id') id: string,
    @Body() body: { notes?: string; signatureUrl?: string },
    @Req() req: any,
  ) {
    return this.orderService.gmApprove(id, body, req.user.userId);
  }

  @Post(':id/po/send-email')
  @Roles(...PERMISSIONS.ORDER_PO_SEND_EMAIL)
  @ApiOperation({ summary: 'Purchasing: kirim PO PDF ke email supplier' })
  async sendPoEmail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.poGeneration.sendPoEmail(id, user.userId);
  }

  @Post(':id/gm-reject')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'GM reject' })
  async gmReject(
    @Param('id') id: string,
    @Body() body: { notes: string },
    @Req() req: any,
  ) {
    return this.orderService.gmReject(id, body, req.user.userId);
  }

  @Post(':id/finance-process')
  @Roles(Role.FINANCE)
  @ApiOperation({ summary: 'Finance: konfirmasi pembayaran / unggah bukti (tanpa deduct — sudah di GM)' })
  async financeProcess(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FinanceProcessDto)) dto: FinanceProcessDtoType,
    @Req() req: any,
  ) {
    return this.orderService.financeProcess(id, dto, req.user.userId);
  }

  @Post(':id/verify-items')
  @Roles(Role.ADMIN_STOCK)
  @ApiOperation({ summary: 'Admin Stok verifikasi barang datang' })
  async verifyItems(
    @Param('id') id: string,
    @Body()
    body: {
      status: 'SESUAI' | 'TIDAK_SESUAI';
      verificationNotes?: string;
    },
    @Req() req: any,
  ) {
    return this.orderService.verifyItems(id, body, req.user.userId);
  }

  @Post(':id/cancel')
  @Roles(...PERMISSIONS.ORDER_CANCEL)
  @ApiOperation({ summary: 'Batalkan order (refund otomatis bila sudah dipotong di GM)' })
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CancelOrderDto)) dto: CancelOrderDtoType,
    @Req() req: any,
  ) {
    return this.orderService.cancel(id, dto, req.user.userId, req.user.role);
  }
}
