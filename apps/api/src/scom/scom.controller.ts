import { Controller, Post, Param, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ScomService } from './scom.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('SCOM')
@Controller('permit-clusters/:clusterId/scom')
export class ScomController {
  constructor(private readonly scomService: ScomService) {}

  @Post()
  @Roles(...PERMISSIONS.SCOM_CREATE)
  @ApiOperation({ summary: 'Buat rekaman SCOM' })
  async create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      conductedAt: string;
      location: string;
      attendees: object;
      agreementPoints: object;
      workingHours?: string;
      safetyRules?: string;
      cleanlinessRules?: string;
    },
    @Req() req: any,
  ) {
    return this.scomService.create(clusterId, body, req.user.userId);
  }

  @Post(':scomId/complete')
  @Roles(...PERMISSIONS.SCOM_CREATE)
  @ApiOperation({ summary: 'Selesaikan SCOM — generate MoM PDF' })
  async complete(
    @Param('scomId') scomId: string,
    @Body() body: { pksSignedUrl?: string },
    @Req() req: any,
  ) {
    return this.scomService.complete(scomId, body.pksSignedUrl, req.user.userId);
  }
}
