import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupplierInvoiceService } from './supplier-invoice.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  UploadInvoiceDto,
  UpdateInvoiceDto,
  SupplierAckDto,
  SupplierRejectDto,
  FilterInvoiceDto,
  type UploadInvoiceDtoType,
  type UpdateInvoiceDtoType,
  type SupplierAckDtoType,
  type SupplierRejectDtoType,
  type FilterInvoiceDtoType,
} from './supplier-invoice.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';

@ApiTags('Supplier Invoices')
@Controller('supplier-invoices')
export class SupplierInvoiceController {
  constructor(private readonly service: SupplierInvoiceService) {}

  @Get()
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_VIEW)
  @ApiOperation({ summary: 'Daftar tagihan supplier' })
  async findAll(@Query(new ZodValidationPipe(FilterInvoiceDto)) filter: FilterInvoiceDtoType) {
    return this.service.findAll(filter);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_VIEW)
  @ApiOperation({ summary: 'Detail tagihan' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_UPLOAD)
  @ApiOperation({ summary: 'Upload tagihan baru (status DRAFT)' })
  async upload(
    @Body(new ZodValidationPipe(UploadInvoiceDto)) dto: UploadInvoiceDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upload(dto, user.userId);
  }

  @Patch(':id')
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_UPLOAD)
  @ApiOperation({ summary: 'Perbarui tagihan (DRAFT / ditolak supplier → DRAFT)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceDto)) dto: UpdateInvoiceDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Post(':id/send')
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_SEND_EMAIL)
  @ApiOperation({ summary: 'Kirim tagihan ke email supplier' })
  async sendToSupplier(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.sendToSupplier(id, user.userId);
  }

  @Post(':id/supplier-ack')
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_SUPPLIER_ACK)
  @ApiOperation({ summary: 'Tandai supplier menyetujui tagihan (manual Finance)' })
  async markSupplierAck(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SupplierAckDto)) dto: SupplierAckDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markSupplierAck(id, dto, user.userId);
  }

  @Post(':id/supplier-reject')
  @Roles(...PERMISSIONS.SUPPLIER_INVOICE_SUPPLIER_ACK)
  @ApiOperation({ summary: 'Tandai supplier menolak tagihan (manual Finance)' })
  async markSupplierReject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SupplierRejectDto)) dto: SupplierRejectDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markSupplierReject(id, dto, user.userId);
  }
}
