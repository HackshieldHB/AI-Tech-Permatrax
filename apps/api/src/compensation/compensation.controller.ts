import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CompensationService } from './compensation.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('Compensation / BAK')
@Controller('permit-clusters/:clusterId/compensation')
export class CompensationController {
  constructor(private readonly compensationService: CompensationService) {}

  @Get()
  @Roles(...PERMISSIONS.SOCIALIZATION_VIEW)
  @ApiOperation({ summary: 'Data kompensasi cluster' })
  async getOne(@Param('clusterId') clusterId: string) {
    return this.compensationService.getByCluster(clusterId);
  }

  @Post()
  @Roles(...PERMISSIONS.COMPENSATION_CREATE)
  @ApiOperation({ summary: 'Buat rekaman negosiasi awal' })
  async create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      homepasCount: number;
      scheme: 'PER_HOMEPASS' | 'LUMP_SUM';
      proposedAmount: string;
      notes?: string;
    },
    @Req() req: any,
  ) {
    return this.compensationService.create(clusterId, body, req.user.userId);
  }

  @Post(':id/negotiation-round')
  @Roles(...PERMISSIONS.COMPENSATION_CREATE)
  @ApiOperation({ summary: 'Tambah ronde negosiasi' })
  async round(
    @Param('id') id: string,
    @Body() body: { proposedAmount: string; rtResponse: string; notes?: string },
    @Req() req: any,
  ) {
    return this.compensationService.addNegotiationRound(id, body, req.user.userId);
  }
}
