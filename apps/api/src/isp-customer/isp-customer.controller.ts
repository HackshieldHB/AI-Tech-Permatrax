import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IspCustomerService } from './isp-customer.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

// NEW: IspCustomerController — GM manages ISP customer reference list
@ApiTags('ISP Customers')
@Controller('isp-customers')
export class IspCustomerController {
  constructor(private readonly ispCustomerService: IspCustomerService) {}

  @Get()
  @ApiOperation({ summary: 'List semua ISP customer (untuk dropdown)' })
  async findAll() { return this.ispCustomerService.findAll(); }

  @Get('active')
  @ApiOperation({ summary: 'List ISP customer aktif saja' })
  async findActive() { return this.ispCustomerService.findActive(); }

  @Post()
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'GM tambah ISP customer baru' })
  async create(@Body() body: any, @Req() req: any) {
    return this.ispCustomerService.create(body, req.user.userId);
  }

  @Patch(':id')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'GM update ISP customer' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.ispCustomerService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'GM deactivate ISP customer' })
  async deactivate(@Param('id') id: string) {
    return this.ispCustomerService.deactivate(id);
  }
}
