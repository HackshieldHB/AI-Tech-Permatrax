import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { z } from 'zod';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { FinanceReportService } from './finance-report.service';

const ReportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('Finance Reports')
@Controller('finance-reports')
export class FinanceReportController {
  constructor(private readonly reports: FinanceReportService) {}

  @Get('project/:id/excel')
  @Roles(...PERMISSIONS.FINANCE_REPORT_EXPORT)
  @ApiOperation({ summary: 'Ekspor laporan proyek (Excel)' })
  async projectExcel(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const parsed = ReportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const buf = await this.reports.exportProjectExcel(id, parsed.data);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="laporan-proyek-${id.slice(0, 8)}-${stamp}.xlsx"`,
    );
    res.send(buf);
  }

  @Get('project/:id/pdf')
  @Roles(...PERMISSIONS.FINANCE_REPORT_EXPORT)
  @ApiOperation({ summary: 'Ekspor laporan proyek (PDF)' })
  async projectPdf(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const parsed = ReportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const buf = await this.reports.exportProjectPdf(id, parsed.data);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="laporan-proyek-${id.slice(0, 8)}-${stamp}.pdf"`,
    );
    res.send(buf);
  }

  @Get('summary/excel')
  @Roles(...PERMISSIONS.FINANCE_REPORT_EXPORT)
  @ApiOperation({ summary: 'Ekspor ringkasan semua proyek (Excel)' })
  async summaryExcel(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const parsed = ReportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const buf = await this.reports.exportSummaryExcel(parsed.data);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="laporan-ringkasan-keuangan-${stamp}.xlsx"`,
    );
    res.send(buf);
  }

  @Get('summary/pdf')
  @Roles(...PERMISSIONS.FINANCE_REPORT_EXPORT)
  @ApiOperation({ summary: 'Ekspor ringkasan semua proyek (PDF)' })
  async summaryPdf(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const parsed = ReportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const buf = await this.reports.exportSummaryPdf(parsed.data);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="laporan-ringkasan-keuangan-${stamp}.pdf"`,
    );
    res.send(buf);
  }
}
