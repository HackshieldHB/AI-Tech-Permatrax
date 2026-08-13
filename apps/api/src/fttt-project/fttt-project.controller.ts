import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/types/auth-user.types';
import { FtttProjectService } from './fttt-project.service';
import {
  AcceptFinancialRequestDto,
  AddClosingLogDto,
  AddFtttTransactionDto,
  AddImplLogDto,
  AddJaminanDto,
  AddReconDocDto,
  AddBeginningGroupDto,
  AddSiteToBulkyDto,
  AddSpanDto,
  CompleteBeginningEndingsDto,
  AddSpanLogDto,
  AdvancePhaseDto,
  ApproveDocumentDto,
  CreateFtttProjectDto,
  DeclineFinancialRequestDto,
  DisburseFtttTransactionDto,
  FinancialRequestInboxFilterDto,
  FtttProjectFilterDto,
  ResolveSanggahDto,
  SetImplementationTypeDto,
  SetPaymentStatusDto,
  SetPhasePlanDto,
  SetTotalPanjangDto,
  SubmitSanggahDto,
  UploadDocumentDto,
  UploadDrmDocDto,
  UploadSurveyDto,
  UpsertSurveySiteDto,
  MarkSurveySiteDto,
} from './fttt-project.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Role } from '@prisma/client'; // kept for approveDocument role check

const maxUploadBytes = Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024;
const upload = {
  storage: memoryStorage(),
  limits: { fileSize: maxUploadBytes },
};

@UseGuards(JwtAuthGuard)
@Controller('fttt-projects')
export class FtttProjectController {
  constructor(private readonly service: FtttProjectService) {}

  // POST /fttt-projects  (multipart: triggerDoc + JSON fields)
  @Post()
  @UseInterceptors(FileInterceptor('triggerDoc', upload))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body('data') rawData: string,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = CreateFtttProjectDto.safeParse(JSON.parse(rawData));
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Data project tidak valid',
      );
    }
    return this.service.create(parsed.data, file, user.userId, user.role);
  }

  // GET /fttt-projects
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(FtttProjectFilterDto)) filters: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(filters, user.userId, user.role);
  }

  // GET /fttt-projects/finance-options  (active FTTT finance projects for the create dropdown)
  // NOTE: must be declared before ':id' so it is not captured as an id param
  @Get('finance-options')
  listFinanceOptions() {
    return this.service.listFinanceOptions();
  }

  // GET /fttt-projects/by-finance/:financeProjectId/monitoring  (Finance-side FTTT view)
  @Get('by-finance/:financeProjectId/monitoring')
  getMonitoringByFinance(@Param('financeProjectId') financeProjectId: string) {
    return this.service.getMonitoringByFinance(financeProjectId);
  }

  // Stable v1: Approval Dana inbox — must be before ':id'
  @Get('financial-requests')
  listFinancialRequests(
    @Query(new ZodValidationPipe(FinancialRequestInboxFilterDto)) filter: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.listFinancialRequests(filter, user.userId, user.role);
  }

  @Get('financial-requests/inbox-count')
  financialRequestInboxCount(@CurrentUser() user: AuthUser) {
    return this.service.financialRequestInboxCount(user.userId, user.role);
  }

  @Post('financial-requests/:txId/mark-read')
  markFinancialRequestRead(
    @Param('txId') txId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markFinancialRequestRead(txId, user.userId, user.role);
  }

  // GET /fttt-projects/:id
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findOne(id, user.userId, user.role);
  }

  // ─── Integra V1: Bulky Project → Site management ─────────────────────────

  // GET /fttt-projects/:id/sites
  @Get(':id/sites')
  listSites(@Param('id') id: string) {
    return this.service.listSites(id);
  }

  // GET /fttt-projects/:id/available-finance-sites
  @Get(':id/available-finance-sites')
  listAvailableFinanceSites(@Param('id') id: string) {
    return this.service.listAvailableFinanceSites(id);
  }

  // POST /fttt-projects/:id/sites
  @Post(':id/sites')
  addSite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddSiteToBulkyDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addSite(id, dto.financeProjectId, user.userId, user.role);
  }

  // DELETE /fttt-projects/sites/:siteId
  @Delete('sites/:siteId')
  deleteSite(
    @Param('siteId') siteId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteSite(siteId, user.userId, user.role);
  }

  // URGENT: Beginning → Ending Site relationships (Site Initiation)
  @Get(':id/beginning-groups')
  listBeginningGroups(@Param('id') id: string) {
    return this.service.listBeginningGroups(id);
  }

  @Post(':id/beginning-groups')
  addBeginningGroup(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddBeginningGroupDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addBeginningGroup(
      id,
      dto.beginningFinanceSiteId,
      user.userId,
      user.role,
    );
  }

  @Post(':id/beginning-groups/:groupId/complete')
  completeBeginningEndings(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(CompleteBeginningEndingsDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.completeBeginningEndings(
      id,
      groupId,
      dto.endingFinanceSiteIds,
      user.userId,
      user.role,
    );
  }

  @Delete('beginning-groups/:groupId')
  deleteBeginningGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteBeginningGroup(groupId, user.userId, user.role);
  }

  @Delete('site-endings/:endingId')
  deleteSiteEnding(
    @Param('endingId') endingId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteSiteEnding(endingId, user.userId, user.role);
  }

  // POST /fttt-projects/:id/close — Integra V11: Close Parent (Bulky) Project
  @Post(':id/close')
  closeParent(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.closeParent(id, user.userId, user.role);
  }

  // GET /fttt-projects/:id/budget-scurve  (budget summary + cost/progress S-curve)
  @Get(':id/budget-scurve')
  getBudgetScurve(@Param('id') id: string) {
    return this.service.getBudgetScurve(id);
  }

  // PUT /fttt-projects/:id/phase-plan  (per-phase planned timeline for S-Curve — Admin/PM)
  @Put(':id/phase-plan')
  setPhasePlan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetPhasePlanDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setPhasePlan(id, dto, user.userId, user.role);
  }

  // POST /fttt-projects/:id/transactions  (Implementation Transaction Log — PM FTTT)
  @Post(':id/transactions')
  addTransaction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddFtttTransactionDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addTransaction(id, dto, user.userId, user.role);
  }

  // PUT /fttt-projects/transactions/:txId/disburse  (Finance — Tanggal Dana Keluar + multi Bukti Transfer)
  @Put('transactions/:txId/disburse')
  @UseInterceptors(FilesInterceptor('files', 10, upload))
  disburseTransaction(
    @Param('txId') txId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('disbursedAt') disbursedAt: string,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = DisburseFtttTransactionDto.safeParse({ disbursedAt });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Tanggal Dana Keluar wajib diisi');
    }
    return this.service.disburseTransaction(txId, parsed.data.disbursedAt, user.userId, user.role, files ?? []);
  }

  // POST /fttt-projects/transactions/:txId/accept  (Finance — Financial Request Accepted)
  @Post('transactions/:txId/accept')
  acceptFinancialRequest(
    @Param('txId') txId: string,
    @Body(new ZodValidationPipe(AcceptFinancialRequestDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.acceptFinancialRequest(txId, dto.scheduledReleaseAt, user.userId, user.role);
  }

  // POST /fttt-projects/transactions/:txId/decline  (Finance — Financial Request Declined)
  @Post('transactions/:txId/decline')
  declineFinancialRequest(
    @Param('txId') txId: string,
    @Body(new ZodValidationPipe(DeclineFinancialRequestDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.declineFinancialRequest(txId, dto.declinedReason, user.userId, user.role);
  }

  // DELETE /fttt-projects/transactions/:txId
  @Delete('transactions/:txId')
  deleteTransaction(
    @Param('txId') txId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteTransaction(txId, user.userId, user.role);
  }

  // GET /fttt-projects/:id/progress  — live progress bar data
  @Get(':id/progress')
  getProgress(@Param('id') id: string) {
    return this.service.getProgress(id);
  }

  // GET /fttt-projects/:id/phase-readiness
  @Get(':id/phase-readiness')
  checkReadiness(@Param('id') id: string) {
    return this.service.checkPhaseReadiness(id);
  }

  // POST /fttt-projects/:id/submit-survey-review  (C6-PST2: Surveyor submits survey to PM)
  @Post(':id/submit-survey-review')
  submitSurveyForReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submitSurveyForReview(id, user.userId, user.role);
  }

  // PUT /fttt-projects/:id/review-survey  (C6-PST2: PM approves/rejects survey)
  @Put(':id/review-survey')
  reviewSurveyPhase(
    @Param('id') id: string,
    @Body('approved') approved: boolean,
    @Body('rejectionNotes') rejectionNotes: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reviewSurveyPhase(id, approved, rejectionNotes, user.userId, user.role);
  }

  // POST /fttt-projects/:id/mark-implementation-done  (C6-PST4: Surveyor marks lapangan done)
  @Post(':id/mark-implementation-done')
  markImplementationLapanganDone(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markImplementationLapanganDone(id, user.userId, user.role);
  }

  // PUT /fttt-projects/:id/total-panjang  (iFORTE GENERAL: total panjang pekerjaan meter)
  @Put(':id/total-panjang')
  setTotalPanjang(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetTotalPanjangDto)) dto: { meters: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setTotalPanjang(id, dto.meters, user.userId, user.role);
  }

  // PUT /fttt-projects/:id/payment-status  (iFORTE Closing: monitoring pembayaran)
  @Put(':id/payment-status')
  setPaymentStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetPaymentStatusDto)) dto: { status: 'UNPAID' | 'PAID' },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setPaymentStatus(id, dto.status, user.userId, user.role);
  }

  // POST /fttt-projects/:id/advance-phase
  @Post(':id/advance-phase')
  advancePhase(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdvancePhaseDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.advancePhase(id, dto, user.userId, user.role);
  }

  // DELETE /fttt-projects/:id/survey-uploads/:uploadId  (C5-Issue5)
  @Delete(':id/survey-uploads/:uploadId')
  deleteSurveyUpload(
    @Param('id') id: string,
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteSurveyUpload(id, uploadId, user.userId, user.role);
  }

  // POST /fttt-projects/:id/survey-uploads
  // C7.1: Only Surveyor can upload survey documents
  @Post(':id/survey-uploads')
  @UseInterceptors(FileInterceptor('file', upload))
  uploadSurvey(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(UploadSurveyDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.uploadSurveyEvidence(id, file, dto, user.userId, user.role);
  }

  // GET /fttt-projects/:id/survey-sites
  @Get(':id/survey-sites')
  listSurveySites(@Param('id') id: string) {
    return this.service.listSurveySites(id);
  }

  // POST /fttt-projects/:id/survey-sites
  @Post(':id/survey-sites')
  addSurveySite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpsertSurveySiteDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addSurveySite(id, dto, user.role);
  }

  // PUT /fttt-projects/:id/survey-sites/:siteId
  @Put(':id/survey-sites/:siteId')
  markSurveySite(
    @Param('id') id: string,
    @Param('siteId') siteId: string,
    @Body(new ZodValidationPipe(MarkSurveySiteDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markSurveySite(id, siteId, dto, user.role);
  }

  // DELETE /fttt-projects/:id/survey-sites/:siteId
  @Delete(':id/survey-sites/:siteId')
  deleteSurveySite(
    @Param('id') id: string,
    @Param('siteId') siteId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteSurveySite(id, siteId, user.role);
  }

  // POST /fttt-projects/:id/drm-documents
  @Post(':id/drm-documents')
  @UseInterceptors(FileInterceptor('file', upload))
  uploadDrm(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadDrmDocDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.uploadDrmDocument(id, file, dto, user.userId);
  }

  // GET /fttt-projects/:id/drm-documents
  @Get(':id/drm-documents')
  getDrmHistory(@Param('id') id: string) {
    return this.service.getDrmHistory(id);
  }

  // POST /fttt-projects/:id/sanggah
  @Post(':id/sanggah')
  @UseInterceptors(FileInterceptor('file', upload))
  submitSanggah(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(SubmitSanggahDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submitSanggah(id, dto, file, user.userId);
  }

  // PUT /fttt-projects/sanggah/:sanggahId/resolve
  @Put('sanggah/:sanggahId/resolve')
  resolveSanggah(
    @Param('sanggahId') sanggahId: string,
    @Body(new ZodValidationPipe(ResolveSanggahDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resolveSanggah(sanggahId, dto, user.userId);
  }

  // POST /fttt-projects/:id/jaminan  (Finance only — enforced in service)
  @Post(':id/jaminan')
  @UseInterceptors(FileInterceptor('file', upload))
  addJaminan(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(AddJaminanDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addJaminan(id, dto, file, user.userId, user.role);
  }

  // PUT /fttt-projects/:id/trigger-doc  (Issue 13: Admin/PM replaces trigger doc in INITIATION)
  @Put(':id/trigger-doc')
  @UseInterceptors(FileInterceptor('file', upload))
  replaceTriggerDoc(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.replaceTriggerDoc(id, file, user.userId, user.role);
  }

  // POST /fttt-projects/:id/documents  (Surveyor FTTT only; file OR formContent required)
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', upload))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(UploadDocumentDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.uploadDocument(id, file, dto, user.userId, user.role);
  }

  // PUT /fttt-projects/documents/:docId/approve
  @Put('documents/:docId/approve')
  approveDocument(
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(ApproveDocumentDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approveDocument(docId, dto, user.userId, user.role);
  }

  // PUT /fttt-projects/documents/:docId/replace  (Issue #6 — Surveyor replaces rejected doc)
  @Put('documents/:docId/replace')
  @UseInterceptors(FileInterceptor('file', upload))
  replaceDocument(
    @Param('docId') docId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('notes') notes: string | undefined,
    @Body('formContent') formContent: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.replaceDocument(docId, file, user.userId, user.role, notes, formContent);
  }

  // POST /fttt-projects/:id/implementation-logs  (Implementation phase logs)
  @Post(':id/implementation-logs')
  @UseInterceptors(FileInterceptor('file', upload))
  addImplementationLog(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(AddImplLogDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addImplementationLog(id, dto, file, user.userId, user.role);
  }

  // POST /fttt-projects/:id/recon-docs  (Issue #4 — Reconciliation & Billing docs)
  @Post(':id/recon-docs')
  @UseInterceptors(FileInterceptor('file', upload))
  upsertReconDoc(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(AddReconDocDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upsertReconDoc(id, dto, file, user.userId, user.role);
  }

  // PUT /fttt-projects/recon-docs/:docId/approve
  @Put('recon-docs/:docId/approve')
  approveReconDoc(
    @Param('docId') docId: string,
    @Body('approved') approved: boolean,
    @Body('rejectionNotes') rejectionNotes: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approveReconDoc(docId, approved, rejectionNotes, user.userId, user.role);
  }

  // POST /fttt-projects/:id/closing-logs  (Project Closing phase)
  @Post(':id/closing-logs')
  @UseInterceptors(FileInterceptor('file', upload))
  addClosingLog(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(AddClosingLogDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addClosingLog(id, dto, file, user.userId, user.role);
  }

  // PUT /fttt-projects/closing-logs/:logId/approve  (PM approves BAST II)
  @Put('closing-logs/:logId/approve')
  approveClosingLog(
    @Param('logId') logId: string,
    @Body('approved') approved: boolean,
    @Body('rejectionNotes') rejectionNotes: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approveClosingLog(logId, approved, rejectionNotes, user.userId, user.role);
  }

  // ─── Span management (Telkom Infra Implementation phase) ──────────────────

  // POST /fttt-projects/:id/spans
  @Post(':id/spans')
  createSpan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddSpanDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createSpan(id, dto, user.userId, user.role);
  }

  // DELETE /fttt-projects/spans/:spanId
  @Delete('spans/:spanId')
  deleteSpan(
    @Param('spanId') spanId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteSpan(spanId, user.userId, user.role);
  }

  // POST /fttt-projects/spans/:spanId/logs
  @Post('spans/:spanId/logs')
  @UseInterceptors(FileInterceptor('file', upload))
  addSpanLog(
    @Param('spanId') spanId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(AddSpanLogDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addSpanLog(spanId, dto, file, user.userId, user.role);
  }

  // DELETE /fttt-projects/span-logs/:logId
  @Delete('span-logs/:logId')
  deleteSpanLog(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deleteSpanLog(logId, user.userId, user.role);
  }

  // ─── JLM: Project Closing maintenance confirmation + PST implementation type ──

  // POST /fttt-projects/:id/confirm-maintenance  (Admin confirms maintenance done)
  @Post(':id/confirm-maintenance')
  confirmMaintenance(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.confirmMaintenance(id, user.userId, user.role);
  }

  // PUT /fttt-projects/:id/implementation-type  (PST: Galian / KU)
  @Put(':id/implementation-type')
  setImplementationType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetImplementationTypeDto)) dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setImplementationType(id, dto.type, user.userId, user.role);
  }
}
