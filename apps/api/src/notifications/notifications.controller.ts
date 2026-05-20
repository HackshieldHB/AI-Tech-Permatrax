import { Controller, Get, Post, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('my')
  @Roles(
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.DESIGNER,
    Role.ADMIN, Role.ADMIN_STOCK, Role.GENERAL_MANAGER, Role.FINANCE,
    Role.PURCHASING,
    Role.MARKETING, Role.MARKETING_HEAD, Role.OPERATIONAL_MANAGER,
  )
  @ApiOperation({ summary: 'Notifikasi untuk user saat ini' })
  async my(@Req() req: any, @Query('limit') limit?: string, @Query('unread') unread?: string) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.notificationsService.findForUser(req.user.userId, {
      limit: Number.isFinite(n) ? n : 20,
      unreadOnly: unread === 'true',
    }); // FIX: filter unread
  }

  @Post('mark-all-read')
  @Roles(
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.DESIGNER,
    Role.ADMIN, Role.ADMIN_STOCK, Role.GENERAL_MANAGER, Role.FINANCE,
    Role.PURCHASING,
    Role.MARKETING, Role.MARKETING_HEAD, Role.OPERATIONAL_MANAGER,
  )
  @ApiOperation({ summary: 'Tandai semua sudah dibaca' })
  async markAll(@Req() req: any) {
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  @Post(':id/read')
  @Roles(
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.DESIGNER,
    Role.ADMIN, Role.ADMIN_STOCK, Role.GENERAL_MANAGER, Role.FINANCE,
    Role.PURCHASING,
    Role.MARKETING, Role.MARKETING_HEAD, Role.OPERATIONAL_MANAGER,
  )
  @ApiOperation({ summary: 'Tandai satu notifikasi dibaca' })
  async markOne(@Param('id') id: string, @Req() req: any) {
    return this.notificationsService.markAsRead(id, req.user.userId);
  }
}
