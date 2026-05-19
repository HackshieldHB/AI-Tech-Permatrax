import { Controller, Get, Res } from '@nestjs/common'; // FIX: remove local UseGuards usage; rely on global APP_GUARD
import { Response } from 'express';
import { ReportService } from './report.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';

@ApiTags('Executive Reporting')
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('export-audit')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE)
  @ApiOperation({ summary: 'Extract highly nested DB hierarchies natively bounded into pure flat CSV tables.' })
  async exportAudit(@Res() res: Response) {
    const csvData = await this.reportService.generateAuditCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="permatrax-global-audit.csv"');
    return res.status(200).send(csvData);
  }
}
