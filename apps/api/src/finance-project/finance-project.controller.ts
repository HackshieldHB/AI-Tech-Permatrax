import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { FinanceProjectService } from './finance-project.service';
import { FinanceForecastService } from '../finance-forecast/finance-forecast.service';
import {
  CreateFinanceProjectDto,
  CreateFinanceSiteDto,
  FinanceProjectFilterDto,
  LedgerFilterDto,
  SetTimelineDto,
  UpdateBudgetDto,
  UpdateFinanceProjectDto,
  UpdatePlanningDto,
} from './finance-project.dto';

const upload = { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } };

@ApiTags('Finance Projects')
@Controller('finance-projects')
export class FinanceProjectController {
  constructor(
    private readonly financeProjectService: FinanceProjectService,
    private readonly forecastService: FinanceForecastService,
  ) {}

  @Get()
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Daftar proyek keuangan' })
  async list(@Query() query: Record<string, unknown>) {
    const parsed = FinanceProjectFilterDto.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.financeProjectService.findAll(parsed.data);
  }

  @Post()
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @ApiOperation({ summary: 'Buat proyek keuangan baru (Segment / STANDALONE / Site via parentId)' })
  async create(@Body() body: unknown, @Req() req: Express.Request & { user: { userId: string } }) {
    const parsed = CreateFinanceProjectDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.financeProjectService.create(parsed.data, req.user.userId);
  }

  @Get(':id/sites')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Daftar Site di dalam Segment' })
  async listSites(@Param('id') id: string) {
    return this.financeProjectService.listSites(id);
  }

  @Post(':id/sites')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @ApiOperation({ summary: 'Tambah Site di bawah Segment' })
  async createSite(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const parsed = CreateFinanceSiteDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.financeProjectService.createSite(id, parsed.data, req.user.userId);
  }

  @Get(':id/plan-template')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Download template Excel Set Plan Awal' })
  async downloadPlanTemplate(@Res() res: Response) {
    const buf = await this.financeProjectService.buildPlanTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template-set-plan-awal.xlsx"');
    res.send(buf);
  }

  @Post(':id/plan-import')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_TIMELINE_EDIT)
  @UseInterceptors(FileInterceptor('file', upload))
  @ApiOperation({ summary: 'Import Set Plan Awal dari Excel' })
  async importPlan(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.financeProjectService.importPlanFromExcel(id, file);
  }

  @Get(':id/ledger')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Entri ledger untuk satu proyek' })
  async ledger(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    const parsed = LedgerFilterDto.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.financeProjectService.getLedgerEntries(id, parsed.data);
  }

  @Get(':id/adjustments')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Riwayat inisialisasi & penyesuaian budget' })
  async adjustments(@Param('id') id: string) {
    return this.financeProjectService.getAdjustments(id);
  }

  @Get(':id/timeline')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Baseline timeline (milestone) Kurva S FTTT' })
  async getTimeline(@Param('id') id: string) {
    return this.financeProjectService.getTimeline(id);
  }

  @Put(':id/timeline')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_TIMELINE_EDIT)
  @ApiOperation({ summary: 'Set Plan Awal / Edit Planning Kurva S FTTT (Finance + PM FTTT)' })
  async setTimeline(@Param('id') id: string, @Body() body: unknown) {
    const parsed = SetTimelineDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.financeProjectService.setTimeline(id, parsed.data);
  }

  @Patch(':id/budget')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @ApiOperation({ summary: 'Perbarui alokasi budget' })
  async patchBudget(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const parsed = UpdateBudgetDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.financeProjectService.updateBudget(id, parsed.data, req.user.userId);
  }

  @Get(':id/forecast')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Perkiraan burn rate & proyeksi budget' })
  async forecast(@Param('id') id: string) {
    return this.forecastService.getForecast(id);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Detail proyek keuangan' })
  async findOne(@Param('id') id: string) {
    return this.financeProjectService.findOne(id);
  }

  @Patch(':id')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @ApiOperation({ summary: 'Perbarui metadata / status proyek' })
  async patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const parsed = UpdateFinanceProjectDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.financeProjectService.update(id, parsed.data, req.user.userId);
  }

  @Post(':id/planning')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @ApiOperation({ summary: 'Simpan perencanaan budget bulanan (S-Curve)' })
  async updatePlanning(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdatePlanningDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.financeProjectService.updatePlanning(id, parsed.data);
  }

  @Get(':id/s-curve-data')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_VIEW)
  @ApiOperation({ summary: 'Ambil data chart S-Curve (Planning vs Actual Bulanan)' })
  async getSCurveData(@Param('id') id: string) {
    const [planning, actual] = await Promise.all([
      this.financeProjectService.getPlanning(id),
      this.financeProjectService.getActualByMonth(id),
    ]);
    return { planning, actual };
  }
}
