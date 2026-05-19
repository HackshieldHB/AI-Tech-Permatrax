import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { IspEmailService } from './isp-email.service';

@Controller()
export class IspEmailController {
  constructor(private readonly service: IspEmailService) {}

  @Get('isp-email-config')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.GENERAL_MANAGER)
  list() {
    return this.service.listConfigs(); // NEW: list all ISP email configs
  }

  @Get('isp-email-config/:ispName')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.GENERAL_MANAGER)
  one(@Param('ispName') ispName: string) {
    return this.service.getConfig(ispName); // NEW: read single ISP config
  }

  @Post('isp-email-config')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.GENERAL_MANAGER)
  create(@Body() body: { ispName: string; emailTo: string[]; emailCc?: string[]; emailBcc?: string[]; smtpNotes?: string }, @Req() req: any) {
    return this.service.upsertConfig(body.ispName, body, req.user.userId); // NEW: create config
  }

  @Put('isp-email-config/:ispName')
  @Roles(Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.GENERAL_MANAGER)
  update(@Param('ispName') ispName: string, @Body() body: { emailTo: string[]; emailCc?: string[]; emailBcc?: string[]; smtpNotes?: string }, @Req() req: any) {
    return this.service.upsertConfig(ispName, body, req.user.userId); // NEW: update config
  }

  @Post('permit-clusters/:id/send-to-isp')
  @Roles(Role.ADMIN)
  send(@Param('id') id: string, @Body() body: { emailTo: string[]; emailCc?: string[]; subject: string; message: string }, @Req() req: any) {
    return this.service.sendSipPackage(id, body, req.user.userId); // NEW: send SIP package to ISP
  }
}
