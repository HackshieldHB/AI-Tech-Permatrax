import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  ApproveBudgetTransferDto,
  BudgetTransferFilterDto,
  RejectBudgetTransferDto,
  SubmitBudgetTransferDto,
} from './budget-transfer.dto';
import { BudgetTransferService } from './budget-transfer.service';

const BUDGET_TRANSFER_READ_ROLES = [...PERMISSIONS.BUDGET_TRANSFER_VIEW];

@ApiTags('Budget Transfer')
@Controller('budget-transfers')
export class BudgetTransferController {
  constructor(private readonly service: BudgetTransferService) {}

  @Post()
  @Roles(...PERMISSIONS.BUDGET_TRANSFER_SUBMIT)
  @ApiOperation({ summary: 'Ajukan transfer antar proyek (menunggu GM)' })
  async submit(@Body() body: unknown, @Req() req: Express.Request & { user: { userId: string } }) {
    const parsed = SubmitBudgetTransferDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.submit(parsed.data, req.user.userId);
  }

  @Get()
  @Roles(...BUDGET_TRANSFER_READ_ROLES)
  @ApiOperation({ summary: 'Daftar transfer budget' })
  async findAll(@Query() query: Record<string, unknown>) {
    const parsed = BudgetTransferFilterDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.findAll(parsed.data);
  }

  @Get(':id')
  @Roles(...BUDGET_TRANSFER_READ_ROLES)
  @ApiOperation({ summary: 'Detail transfer budget' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/approve')
  @Roles(...PERMISSIONS.BUDGET_TRANSFER_APPROVE)
  @ApiOperation({ summary: 'Setujui transfer (GM)' })
  async approve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const parsed = ApproveBudgetTransferDto.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.approveByGm(id, req.user.userId, parsed.data.notes);
  }

  @Patch(':id/reject')
  @Roles(...PERMISSIONS.BUDGET_TRANSFER_APPROVE)
  @ApiOperation({ summary: 'Tolak transfer (GM)' })
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const parsed = RejectBudgetTransferDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.rejectByGm(id, req.user.userId, parsed.data.reason);
  }

  @Post(':id/cancel')
  @Roles(...PERMISSIONS.BUDGET_TRANSFER_SUBMIT)
  @ApiOperation({ summary: 'Batalkan pengajuan (hanya pengaju)' })
  async cancel(@Param('id') id: string, @Req() req: Express.Request & { user: { userId: string } }) {
    return this.service.cancelBySubmitter(id, req.user.userId);
  }
}
