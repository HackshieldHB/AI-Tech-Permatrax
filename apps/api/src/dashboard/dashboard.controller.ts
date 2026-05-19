import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @Roles(Role.GENERAL_MANAGER, Role.PM_SENIOR)
  @ApiOperation({ summary: 'Ikhtisar sistem (GM / PM Senior)' })
  async gm(@Req() req: any) {
    return this.dashboardService.getGmDashboard();
  }

  // FIX Fix 2A: new lean GM stats endpoint — clean labels + cluster-centric recent activity
  @Get('gm')
  @Roles(Role.GENERAL_MANAGER, Role.PM_SENIOR)
  @ApiOperation({ summary: 'GM ringkas — summary / pipeline / recentActivity (label Indonesia)' })
  async gmStats() {
    return this.dashboardService.getGmStats();
  }

  @Get('sla')
  @Roles(Role.GENERAL_MANAGER, Role.PM_SENIOR)
  @ApiOperation({ summary: 'Laporan SLA per fase perizinan' })
  async sla() {
    return this.dashboardService.getSlaReport();
  }

  @Get('isp/:ispCustomer')
  @Roles(Role.GENERAL_MANAGER, Role.PM_SENIOR, Role.ADMIN)
  @ApiOperation({ summary: 'Metrik per ISP' })
  async isp(@Param('ispCustomer') ispCustomer: string) {
    return this.dashboardService.getIspDashboard(decodeURIComponent(ispCustomer));
  }

  @Get('pipeline-preview')
  @Roles(Role.GENERAL_MANAGER, Role.PM_SENIOR)
  @ApiOperation({ summary: '10 cluster terakhir di-update' })
  async pipelinePreview() {
    return this.dashboardService.getPipelinePreview();
  }

  @Get('pm')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR)
  async pm(@Req() req: any) {
    return this.dashboardService.getPmDashboard(req.user.userId, req.user.role);
  }

  @Get('surveyor')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT)
  async surveyor(@Req() req: any) {
    return this.dashboardService.getSurveyorDashboard(req.user.userId, req.user.fiberType || 'FTTH');
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  async admin() {
    return this.dashboardService.getAdminDashboard();
  }

  @Get('finance')
  @Roles(Role.FINANCE)
  async finance() {
    return this.dashboardService.getFinanceDashboard();
  }

  @Get('designer')
  @Roles(Role.DESIGNER)
  async designer() {
    return this.dashboardService.getDesignerStats(); // FIX: HLD/LLD queue for design team
  }

  @Get('ops')
  @Roles(Role.OPERATIONAL_MANAGER)
  async ops() {
    return this.dashboardService.getOpsStats(); // FIX: Ops Manager KPIs
  }

  @Get('marketing')
  @Roles(Role.MARKETING, Role.MARKETING_HEAD)
  async marketing() {
    return this.dashboardService.getMarketingStats(); // FIX: marketing snapshot
  }

  @Get('admin-stock')
  @Roles(Role.ADMIN_STOCK)
  async adminStock() {
    return this.dashboardService.getAdminStockStats(); // FIX: warehouse KPIs
  }

  @Get('purchasing')
  @Roles(Role.PURCHASING, Role.ADMIN, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Dashboard Purchasing — KPI order & tagihan supplier' })
  async purchasing() {
    return this.dashboardService.getPurchasingDashboard();
  }
}
