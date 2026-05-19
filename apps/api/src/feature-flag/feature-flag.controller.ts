import { Controller, Get, Patch, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FeatureFlagService } from './feature-flag.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { UpdateFeatureFlagSchema } from './feature-flag.dto';

@ApiTags('Feature flags')
@Controller('feature-flags')
export class FeatureFlagController {
  constructor(private readonly featureFlagService: FeatureFlagService) {}

  @Get()
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Semua feature flags' })
  async findAll() {
    return this.featureFlagService.findAll();
  }

  @Get('my-access')
  @ApiOperation({ summary: 'Feature keys untuk role user saat ini' })
  async myAccess(@Req() req: any) {
    return this.featureFlagService.getMyAccess(req.user.role as Role);
  }

  @Patch(':featureKey')
  @Roles(Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Update role + toggle fitur' })
  async update(
    @Param('featureKey') featureKey: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const dto = UpdateFeatureFlagSchema.parse(body);
    return this.featureFlagService.update(featureKey, dto, req.user.userId);
  }
}
