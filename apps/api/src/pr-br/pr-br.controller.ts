import { Controller, Get, Post, Patch, Body, Param, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrBrService } from './pr-br.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('PR/BR')
@Controller('permit-clusters/:clusterId/pr-br')
export class PrBrController {
  constructor(private readonly prBrService: PrBrService) {}

  @Get()
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  async list(@Param('clusterId') clusterId: string) {
    return this.prBrService.findAll(clusterId);
  }

  @Post('pr')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async pr(
    @Param('clusterId') clusterId: string,
    @Body() body: { amount: string; description: string; fileUrl?: string },
    @Req() req: any,
  ) {
    return this.prBrService.createPr(clusterId, body, req.user.userId);
  }

  @Post('br')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async br(
    @Param('clusterId') clusterId: string,
    @Body() body: { amount: string; description: string; fileUrl?: string },
    @Req() req: any,
  ) {
    return this.prBrService.createBr(clusterId, body, req.user.userId);
  }

  @Patch(':id/issue')
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN)
  async issue(@Param('id') id: string, @Req() req: any) {
    return this.prBrService.markIssued(id, req.user.userId);
  }
}
