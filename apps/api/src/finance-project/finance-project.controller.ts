import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { FinanceProjectService } from './finance-project.service';
import { FinanceForecastService } from '../finance-forecast/finance-forecast.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateFinanceProjectDto,
  CreateFinanceSiteDto,
  FinanceProjectFilterDto,
  LedgerFilterDto,
  ReviewPoCustomerDto,
  SetTimelineDto,
  SubmitPoCustomerDto,
  UpdateBudgetDto,
  UpdateFinanceProjectDto,
  UpdatePlanningDto,
  type UpdateFinanceProjectInput,
} from './finance-project.dto';
import { Role, FinanceProjectStatus } from '@prisma/client';
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

  @Get('po-approvals/pending')
  @Roles(Role.GENERAL_MANAGER, Role.FINANCE)
  @ApiOperation({ summary: 'Integra V3: daftar pengajuan PO Customer menunggu GM' })
  async listPendingPoApprovals() {
    return this.financeProjectService.listPendingPoApprovals();
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
  @ApiOperation({ summary: 'Daftar Site di dalam Segment (default: Active only)' })
  async listSites(
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    const statusOpt =
      status === 'ALL' || status === 'all'
        ? 'ALL' as const
        : status === 'CLOSED' || status === 'ARCHIVED' || status === 'ACTIVE'
          ? (status as FinanceProjectStatus)
          : undefined;
    return this.financeProjectService.listSites(id, statusOpt != null ? { status: statusOpt } : undefined);
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
    @Body(new ZodValidationPipe(UpdateFinanceProjectDto)) dto: UpdateFinanceProjectInput,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    return this.financeProjectService.update(id, dto, req.user.userId);
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

  @Get(':id/po-history')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @ApiOperation({ summary: 'Integra V3: riwayat pengajuan PO Customer' })
  async poHistory(@Param('id') id: string) {
    return this.financeProjectService.listPoChangeRequests(id);
  }

  @Post(':id/po-customer')
  @Roles(...PERMISSIONS.FINANCE_PROJECT_MANAGE)
  @UseInterceptors(FileInterceptor('file', upload))
  @ApiOperation({ summary: 'Integra V3: ajukan PO Customer (Finance → GM approval)' })
  async submitPoCustomer(
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Express.Request & { user: { userId: string; role: Role } },
  ) {
    const parsed = SubmitPoCustomerDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.financeProjectService.submitPoCustomer(
      id,
      parsed.data,
      file,
      req.user.userId,
      req.user.role,
    );
  }

  @Post(':id/po-customer/:requestId/review')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Integra V3: GM Approve/Reject PO Customer' })
  async reviewPoCustomer(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string; role: Role } },
  ) {
    const parsed = ReviewPoCustomerDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.financeProjectService.reviewPoCustomer(
      id,
      requestId,
      parsed.data,
      req.user.userId,
      req.user.role,
    );
  }
}
