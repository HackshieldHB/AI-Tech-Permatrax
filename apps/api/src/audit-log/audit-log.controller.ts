import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Audit log')
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Aktivitas sistem terbaru (agregat)' })
  async findAll(@Query('limit') limit?: string) {
    const n = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    return this.auditLogService.findRecent(n);
  }
}
