import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PermitClusterService } from './permit-cluster.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { Role, PermitPhase } from '@prisma/client';
import { PermitClusterFilterDto } from './permit-cluster.dto';

@ApiTags('Permit clusters')
@Controller('permit-clusters')
export class PermitClusterController {
  constructor(private readonly permitClusterService: PermitClusterService) {}

  @Get('stats')
  @Roles(...PERMISSIONS.PERMIT_CLUSTER_VIEW) // FIX: same audience as list — avoid 403 + toast "tidak memiliki akses"
  @ApiOperation({ summary: 'Dashboard stats permit pipeline' })
  async stats() {
    return this.permitClusterService.getDashboardStats();
  }

  @Get('map')
  @Roles(...PERMISSIONS.PERMIT_CLUSTER_VIEW)
  @ApiOperation({ summary: 'Marker permit cluster untuk peta GIS' })
  async mapMarkers(@Req() req: any) {
    return this.permitClusterService.findForMapMarkers(req.user.role, req.user.userId);
  }

  @Get()
  @Roles(...PERMISSIONS.PERMIT_CLUSTER_VIEW)
  @ApiOperation({ summary: 'Daftar permit cluster' })
  async findAll(
    @Query() query: Record<string, unknown>,
    @Req() req: any,
  ) {
    // MODIFIED: validated filter + pagination
    const filters = PermitClusterFilterDto.parse(query);
    return this.permitClusterService.findAll(filters, req.user.role, req.user.userId);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.PERMIT_CLUSTER_VIEW)
  @ApiOperation({ summary: 'Detail cluster + relasi fase' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.permitClusterService.findOne(id, req.user.role, req.user.userId);
  }

  @Post(':id/advance-phase')
  @Roles(Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Override manual fase permit' })
  async advancePhase(
    @Param('id') id: string,
    @Body() body: { newPhase: PermitPhase },
    @Req() req: any,
  ) {
    return this.permitClusterService.advancePhase(
      id,
      body.newPhase,
      req.user.userId,
      req.user.role,
    );
  }
}
