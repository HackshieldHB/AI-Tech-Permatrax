import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PurchasingService } from './purchasing.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  PurchasingInboxFilterDto,
  SubmitPriceDto,
  type PurchasingInboxFilterDtoType,
  type SubmitPriceDtoType,
} from './purchasing.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';

@ApiTags('Purchasing')
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}

  @Get('inbox')
  @Roles(...PERMISSIONS.PURCHASING_VIEW)
  @ApiOperation({ summary: 'Inbox order menunggu input harga' })
  async getInbox(
    @Query(new ZodValidationPipe(PurchasingInboxFilterDto)) filter: PurchasingInboxFilterDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getInbox(user.userId, filter);
  }

  @Get('inbox-count')
  @Roles(...PERMISSIONS.PURCHASING_VIEW)
  @ApiOperation({ summary: 'Jumlah order di inbox purchasing' })
  async getInboxCount() {
    const count = await this.service.getInboxCount();
    return { count };
  }

  @Post('orders/:orderId/submit-price')
  @Roles(...PERMISSIONS.PURCHASING_SUBMIT_PRICE)
  @ApiOperation({ summary: 'Submit supplier + harga satuan per OrderItem' })
  async submitPrice(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(SubmitPriceDto)) dto: SubmitPriceDtoType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submitPrice(orderId, dto, user.userId);
  }
}
