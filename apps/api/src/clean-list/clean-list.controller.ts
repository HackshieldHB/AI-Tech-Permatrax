import {
  Controller, Get, Post, Patch, Body, Param, Query, BadRequestException,
  Req, UseGuards, UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CleanListService } from './clean-list.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { FiberType, Role } from '@prisma/client';
import {
  CreateCleanListDto,
  BulkImportCleanListDto,
  CleanListFilterDto,
} from './clean-list.dto';
import { ParsedExcelRow } from './clean-list.service';

// NEW: CleanListController — manages ISP cluster data
@ApiTags('Clean List')
@Controller('clean-list')
export class CleanListController {
  constructor(private readonly cleanListService: CleanListService) {}

  // NEW: GET /api/clean-list — paginated list with filters
  @Get()
  @Roles(...PERMISSIONS.CLEAN_LIST_VIEW)
  @ApiOperation({ summary: 'List semua cluster clean list dengan filter' })
  async findAll(@Query() query: Record<string, unknown>) {
    // MODIFIED: full query passed to Zod (coercion in schema)
    const filters = CleanListFilterDto.parse(query);
    return this.cleanListService.findAll(filters);
  }

  // NEW: GET /api/clean-list/summary/isp — dashboard summary cards
  @Get('summary/isp')
  @Roles(...PERMISSIONS.CLEAN_LIST_VIEW)
  @ApiOperation({ summary: 'Summary statistik per ISP untuk dashboard' })
  async getSummary() {
    return this.cleanListService.getIspSummary();
  }

  @Get('dashboard-stats')
  @Roles(...PERMISSIONS.CLEAN_LIST_VIEW)
  async getDashboardStats(@Req() req: any) {
    return this.cleanListService.getDashboardStats(req.user.role, req.user.userId);
  }

  @Post('import-excel')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.GENERAL_MANAGER, Role.ADMIN) // FIX: PM + GM + Admin can import Excel clean list
  async importFromExcel(
    @Body() body: { rows: ParsedExcelRow[]; ispCustomer: string; fiberType: string },
    @Req() req: any,
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    if (!body.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
      throw new BadRequestException('Tidak ada data untuk diimport');
    }
    if (body.rows.length > 1000) {
      throw new BadRequestException('Maksimal 1000 baris per import');
    }
    return this.cleanListService.bulkImportFromExcel(
      body.rows,
      req.user.userId,
      body.ispCustomer || 'FiberStar',
      (body.fiberType as FiberType) || FiberType.FTTH,
    );
  }

  // NEW: GET /api/clean-list/:id — single entry detail
  @Get(':id')
  @Roles(...PERMISSIONS.CLEAN_LIST_VIEW)
  @ApiOperation({ summary: 'Detail satu clean list entry' })
  async findOne(@Param('id') id: string) {
    return this.cleanListService.findOne(id);
  }

  // NEW: POST /api/clean-list — single entry import (GM only)
  @Post()
  @Roles(...PERMISSIONS.CLEAN_LIST_IMPORT)
  @ApiOperation({ summary: 'Import satu cluster clean list (GM only)' })
  async create(@Body() body: unknown, @Req() req: any) {
    const dto = CreateCleanListDto.parse(body);
    return this.cleanListService.create(dto, req.user.userId);
  }

  // NEW: POST /api/clean-list/bulk-import — bulk import (GM only)
  @Post('bulk-import')
  @Roles(...PERMISSIONS.CLEAN_LIST_IMPORT)
  @ApiOperation({ summary: 'Bulk import cluster clean list dari JSON (GM only)' })
  async bulkImport(@Body() body: unknown, @Req() req: any) {
    const dto = BulkImportCleanListDto.parse(body);
    return this.cleanListService.bulkImport(dto, req.user.userId);
  }

  // NEW: PATCH /api/clean-list/:id/mark-existing — mark as existing fiber
  @Patch(':id/mark-existing')
  @Roles(...PERMISSIONS.MAP_MARK_EXISTING)
  @ApiOperation({ summary: 'Tandai cluster sebagai sudah ada jaringan existing' })
  async markExisting(
    @Param('id') id: string,
    @Body('operatorName') operatorName: string,
    @Req() req: any,
  ) {
    return this.cleanListService.markExistingFiber(id, operatorName, req.user.userId);
  }

}
