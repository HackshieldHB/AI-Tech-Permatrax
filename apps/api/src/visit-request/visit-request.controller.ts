import {
  Controller, Get, Post, Patch, Body, Param, Query, BadRequestException,
  Req, UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VisitRequestService } from './visit-request.service';
import { BaOpenService } from '../ba-open/ba-open.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { Role } from '@prisma/client';
import {
  CreateVisitRequestDto,
  PmVisitReviewDto,
  ReviewVisitRequestDto,
  SubmitSurveyDataDto,
  VisitRequestFilterDto,
} from './visit-request.dto';

@ApiTags('Visit Requests')
@Controller('visit-requests')
export class VisitRequestController {
  constructor(
    private readonly visitRequestService: VisitRequestService,
    private readonly baOpenService: BaOpenService,
  ) {}

  @Post()
  @Roles(...PERMISSIONS.REQUEST_VISIT_CREATE)
  @ApiOperation({ summary: 'Surveyor membuat visit request baru' })
  async create(@Body() body: unknown, @Req() req: Express.Request & { user: { userId: string } }) {
    const parseResult = CreateVisitRequestDto.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error.issues);
    }
    return this.visitRequestService.create(parseResult.data, req.user.userId);
  }

  @Get()
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'List visit request (role-aware)' })
  async findAll(@Query() query: Record<string, unknown>, @Req() req: Express.Request & { user: { userId: string; role: string } }) {
    const filters = VisitRequestFilterDto.parse(query);
    return this.visitRequestService.findAll(filters, req.user.userId, req.user.role);
  }

  @Get('legacy-existing-fiber')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Audit: VR EXISTING_FIBER tanpa BA Open (legacy)' })
  async getLegacyExistingFiber() {
    return this.visitRequestService.findLegacyExistingFiberWithoutBaOpen();
  }

  @Get(':id/approval-log')
  @Roles(Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Audit trail lengkap untuk satu visit request' })
  async getApprovalLog(@Param('id') id: string) {
    return this.visitRequestService.getApprovalLog(id);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'Detail visit request + approval timeline' })
  async findOne(@Param('id') id: string, @Req() req: Express.Request & { user: { userId: string; role: string } }) {
    return this.visitRequestService.findOne(id, req.user.userId, req.user.role);
  }

  @Patch(':id/pm-visit-review')
  @Roles(...PERMISSIONS.REQUEST_VISIT_GATE_REVIEW)
  @ApiOperation({ summary: 'PM review jadwal kunjungan (sebelum survei lapangan)' })
  async pmVisitReview(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const dto = PmVisitReviewDto.parse(body);
    return this.visitRequestService.pmVisitReview(id, dto, req.user.userId);
  }

  @Patch(':id/survey-data')
  @Roles(...PERMISSIONS.REQUEST_VISIT_CREATE)
  @ApiOperation({ summary: 'Surveyor kirim data survey lapangan setelah jadwal disetujui' })
  async submitSurveyData(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const dto = SubmitSurveyDataDto.parse(body);
    return this.visitRequestService.submitSurveyData(id, dto, req.user.userId);
  }

  @Patch(':id/pm-review')
  @Roles(...PERMISSIONS.REQUEST_VISIT_REVIEW)
  @ApiOperation({ summary: 'PM review hasil survey (setelah data lapangan)' })
  async pmReview(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const dto = ReviewVisitRequestDto.parse(body);
    return this.visitRequestService.pmReview(id, dto, req.user.userId);
  }

  @Patch(':id/pm-senior-review')
  @Roles(Role.PM_SENIOR)
  @ApiOperation({ summary: 'PM Senior review visit request' })
  async pmSeniorReview(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const dto = ReviewVisitRequestDto.parse(body);
    return this.visitRequestService.pmSeniorReview(id, dto, req.user.userId);
  }

  @Patch(':id/admin-approve')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin final approval — triggers BA Open generation' })
  async adminApprove(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    const dto = ReviewVisitRequestDto.parse(body);
    return this.visitRequestService.adminApprove(id, dto, req.user.userId, this.baOpenService);
  }

  @Post(':id/regenerate-ba-open')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Regenerate BA Open untuk VR legacy EXISTING_FIBER tanpa BaOpen' })
  async regenerateBaOpen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.visitRequestService.regenerateBaOpenForLegacyVr(id, user.userId, this.baOpenService);
  }

  @Post(':id/submit')
  @Roles(...PERMISSIONS.REQUEST_VISIT_CREATE)
  @ApiOperation({ summary: 'Surveyor submit draft (jadwal) atau kirim ulang setelah ditolak' })
  async submit(@Param('id') id: string, @Req() req: Express.Request & { user: { userId: string } }) {
    return this.visitRequestService.submit(id, req.user.userId);
  }

  @Post(':id/evidence')
  @Roles(...PERMISSIONS.REQUEST_VISIT_CREATE)
  @UseInterceptors(FilesInterceptor('photos', 10))
  @ApiOperation({ summary: 'Upload foto bukti kunjungan lapangan' })
  async uploadEvidence(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    return this.visitRequestService.uploadEvidence(id, files, req.user.userId);
  }

  @Patch(':id')
  @Roles(Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT)
  @ApiOperation({ summary: 'Surveyor edit draft / revisi setelah penolakan' })
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Express.Request & { user: { userId: string } },
  ) {
    return this.visitRequestService.patchBySurveyor(id, body, req.user.userId);
  }
}
