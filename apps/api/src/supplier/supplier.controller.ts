import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupplierService } from './supplier.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  CreateSupplierDto,
  FilterSupplierDto,
  UpdateSupplierDto,
  type CreateSupplierDtoType,
  type FilterSupplierDtoType,
  type UpdateSupplierDtoType,
} from './supplier.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';

@ApiTags('Suppliers')
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Get()
  @Roles(...PERMISSIONS.SUPPLIER_VIEW)
  @ApiOperation({ summary: 'Daftar supplier (paginated)' })
  async findAll(@Query(new ZodValidationPipe(FilterSupplierDto)) filter: FilterSupplierDtoType) {
    return this.service.findAll(filter);
  }

  @Get('active')
  @Roles(...PERMISSIONS.SUPPLIER_VIEW)
  @ApiOperation({ summary: 'Supplier aktif (autocomplete)' })
  async findActive() {
    return this.service.findActive();
  }

  @Get(':id')
  @Roles(...PERMISSIONS.SUPPLIER_VIEW)
  @ApiOperation({ summary: 'Detail supplier' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(...PERMISSIONS.SUPPLIER_MANAGE)
  @ApiOperation({ summary: 'Buat supplier' })
  async create(
    @Body(new ZodValidationPipe(CreateSupplierDto)) dto: CreateSupplierDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Patch(':id')
  @Roles(...PERMISSIONS.SUPPLIER_MANAGE)
  @ApiOperation({ summary: 'Update supplier' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSupplierDto)) dto: UpdateSupplierDtoType,
  ) {
    return this.service.update(id, dto);
  }

  @Post(':id/deactivate')
  @Roles(...PERMISSIONS.SUPPLIER_MANAGE)
  @ApiOperation({ summary: 'Nonaktifkan supplier' })
  async deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }

  @Post(':id/activate')
  @Roles(...PERMISSIONS.SUPPLIER_MANAGE)
  @ApiOperation({ summary: 'Aktifkan kembali supplier' })
  async activate(@Param('id') id: string) {
    return this.service.activate(id);
  }
}
