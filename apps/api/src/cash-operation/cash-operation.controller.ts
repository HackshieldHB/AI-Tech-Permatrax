import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'; // FIX: PATCH for rejected cash-op resubmit flow
import { ApiOperation, ApiTags } from '@nestjs/swagger'; // FIX
import { Role } from '@prisma/client'; // FIX
import { Roles } from '../auth/decorators/roles.decorator'; // FIX
import { PERMISSIONS } from '../auth/permissions'; // FIX
import {
  ApproveStepDto,
  CreateCashOpDto,
  DisburseDto,
  FilterCashOpDto,
  UploadAttachmentDto,
} from './cash-operation.dto'; // FIX
import { CashOperationService } from './cash-operation.service'; // FIX

// FIX: all roles that can authenticate to cash-operation list/detail/create draft
const ALL_CASH_OP_READ_ROLES = Object.values(Role); // FIX

@ApiTags('Cash Operation') // FIX
@Controller('cash-operation') // FIX
export class CashOperationController {
  constructor(private readonly cashOpService: CashOperationService) {} // FIX

  @Get() // FIX
  @Roles(...ALL_CASH_OP_READ_ROLES) // FIX
  @ApiOperation({ summary: 'List cash operation requests' }) // FIX
  async findAll(@Query() query: Record<string, unknown>, @Req() req: any) {
    const filters = FilterCashOpDto.parse(query); // FIX
    return this.cashOpService.findAll(filters, req.user.userId, req.user.role); // FIX
  }

  @Get('inbox') // FIX: list items waiting for this role (before :id)
  @Roles(...ALL_CASH_OP_READ_ROLES) // FIX
  @ApiOperation({ summary: 'Cash operation inbox for current role' }) // FIX
  async inbox(@Req() req: any) {
    return this.cashOpService.getInboxList(req.user.userId, req.user.role); // FIX
  }

  @Get('inbox-count') // FIX
  @Roles(...ALL_CASH_OP_READ_ROLES) // FIX
  @ApiOperation({ summary: 'Inbox count for current role' }) // FIX
  async inboxCount(@Req() req: any) {
    return this.cashOpService.getInboxCount(req.user.role); // FIX
  }

  @Get('stats') // FIX
  @Roles(...ALL_CASH_OP_READ_ROLES) // FIX
  @ApiOperation({ summary: 'Role-scoped cash operation statistics' }) // FIX
  async stats(@Req() req: any) {
    return this.cashOpService.getDashboardStats(req.user.userId, req.user.role); // FIX
  }

  @Get('presigned-upload') // FIX
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT) // FIX
  @ApiOperation({ summary: 'Generate presigned upload URL for attachment' }) // FIX
  async presignedUpload(@Query('fileName') fileName: string, @Query('contentType') contentType: string) {
    return this.cashOpService.getPresignedUpload(fileName, contentType); // FIX
  }

  @Get(':id') // FIX
  @Roles(...ALL_CASH_OP_READ_ROLES) // FIX
  @ApiOperation({ summary: 'Detail cash operation request' }) // FIX
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.cashOpService.findOne(id, req.user.userId, req.user.role); // FIX
  }

  @Post() // FIX
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT) // FIX
  @ApiOperation({ summary: 'Create draft cash operation request' }) // FIX
  async create(@Body() body: unknown, @Req() req: any) {
    const dto = CreateCashOpDto.parse(body); // FIX
    return this.cashOpService.create(dto, req.user.userId, req.user.role); // FIX
  }

  @Patch(':id') // FIX: allow requester to revise REJECTED request back to DRAFT
  @Roles(...ALL_CASH_OP_READ_ROLES) // FIX
  @ApiOperation({ summary: 'Update rejected cash operation draft' }) // FIX
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.cashOpService.update(id, body as Record<string, unknown>, req.user.userId); // FIX
  }

  @Post(':id/submit') // FIX
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT) // FIX
  @ApiOperation({ summary: 'Submit draft request for approval flow' }) // FIX
  async submit(@Param('id') id: string, @Req() req: any) {
    return this.cashOpService.submit(id, req.user.userId); // FIX
  }

  @Post(':id/approve') // FIX
  @Roles(...PERMISSIONS.CASH_OP_APPROVE) // FIX
  @ApiOperation({ summary: 'Approve/reject current approval step' }) // FIX
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ApproveStepDto.parse(body); // FIX
    return this.cashOpService.approve(id, dto, req.user.userId, req.user.role); // FIX
  }

  @Post(':id/repair-approval') // FIX: rebuild approvalSteps from approvalChain (admin / GM / Finance)
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE) // FIX
  @ApiOperation({ summary: 'Repair cash-op approval steps when out of sync with chain (no APPROVED steps yet)' }) // FIX
  async repairApproval(@Param('id') id: string, @Req() req: any) {
    return this.cashOpService.repairApprovalFromChain(id, req.user.userId, req.user.role); // FIX
  }

  @Post(':id/reject') // FIX: dedicated reject (same as approve with REJECT)
  @Roles(...PERMISSIONS.CASH_OP_APPROVE) // FIX
  @ApiOperation({ summary: 'Reject current approval step' }) // FIX
  async reject(@Param('id') id: string, @Body() body: { notes?: string }, @Req() req: any) {
    return this.cashOpService.rejectRequest(id, req.user.userId, req.user.role, body?.notes ?? 'Ditolak'); // FIX
  }

  @Post(':id/disburse') // FIX
  @Roles(Role.FINANCE) // FIX
  @ApiOperation({ summary: 'Disburse approved request' }) // FIX
  async disburse(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DisburseDto.parse(body); // FIX
    return this.cashOpService.disburse(id, dto, req.user.userId, req.user.role); // FIX
  }

  @Post(':id/attachments') // FIX
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT) // FIX
  @ApiOperation({ summary: 'Attach uploaded file metadata to request' }) // FIX
  async uploadAttachment(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UploadAttachmentDto.parse(body); // FIX
    return this.cashOpService.uploadAttachment(id, dto, req.user.userId); // FIX
  }

  @Delete(':id/attachments/:attachmentId') // FIX
  @Roles(...PERMISSIONS.CASH_OP_SUBMIT, Role.ADMIN, Role.GENERAL_MANAGER) // FIX
  @ApiOperation({ summary: 'Delete attachment from draft request' }) // FIX
  async deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
  ) {
    return this.cashOpService.deleteAttachment(id, attachmentId, req.user.userId, req.user.role); // FIX
  }
} // FIX
