import { Controller, Get, Post, Body, Param, Req, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvoicePackageService } from './invoice-package.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Invoice')
@Controller('permit-clusters/:clusterId/invoice')
export class InvoicePackageController {
  constructor(private readonly invoice: InvoicePackageService) {}

  @Get()
  @Roles(Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE)
  async get(@Param('clusterId') clusterId: string) {
    return this.invoice.getByCluster(clusterId);
  }

  @Post('generate')
  @Roles(Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  async generate(
    @Param('clusterId') clusterId: string,
    @Body() body: { amount: string; supportingDocs?: string[] },
    @Req() req: any,
  ) {
    return this.invoice.generate(clusterId, body, req.user.userId);
  }

  @Post('submit')
  @Roles(Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  async submit(@Param('clusterId') clusterId: string, @Req() req: any) {
    const inv = await this.invoice.getByCluster(clusterId);
    if (!inv) throw new NotFoundException('Invoice belum dibuat');
    return this.invoice.submitToFinance(inv.id, req.user.userId);
  }

  @Post('approve')
  @Roles(Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN)
  async approve(@Param('clusterId') clusterId: string, @Req() req: any) {
    const inv = await this.invoice.getByCluster(clusterId);
    if (!inv) throw new NotFoundException('Invoice belum dibuat');
    return this.invoice.financeApprove(inv.id, req.user.userId);
  }

  @Post('record-payment')
  @Roles(Role.FINANCE, Role.ADMIN)
  async pay(
    @Param('clusterId') clusterId: string,
    @Body() body: { paymentRef: string; paymentEvidenceUrl?: string; paidAt?: string },
    @Req() req: any,
  ) {
    const inv = await this.invoice.getByCluster(clusterId);
    if (!inv) throw new NotFoundException('Invoice belum dibuat');
    return this.invoice.recordPayment(inv.id, body, req.user.userId);
  }

  @Post('follow-up')
  @Roles(Role.PM_SENIOR, Role.ADMIN, Role.FINANCE)
  async followUp(@Param('clusterId') clusterId: string, @Body() body: { notes: string }, @Req() req: any) {
    const inv = await this.invoice.getByCluster(clusterId);
    if (!inv) throw new NotFoundException('Invoice belum dibuat');
    return this.invoice.addFollowUp(inv.id, body.notes, req.user.userId);
  }
}
