import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'; // FIX
import { CashOpStatus, Prisma, Role, StepStatus } from '@prisma/client'; // FIX
import { PrismaService } from '../prisma/prisma.service'; // FIX
import { NotificationsGateway } from '../notifications/notifications.gateway'; // FIX
import { NotificationsService } from '../notifications/notifications.service'; // FIX
import { StorageService } from '../storage/storage.service'; // FIX
import { paginate } from '../common/dto/pagination.dto'; // FIX
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service'; // FIX
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util'; // FIX
import type { UtilizationPair } from '../budget-ledger/budget-ledger.service'; // FIX
import { CashOpPartialRefundType } from '../budget-ledger/budget-ledger.service'; // M2: reimbursement variance
import {
  ApproveStepDto,
  CreateCashOpDto,
  DisburseDto,
  FilterCashOpDto,
  UploadAttachmentDto,
} from './cash-operation.dto'; // FIX

// FIX: Role display labels for notifications / errors
const ROLE_LABELS: Record<string, string> = {
  SURVEYOR_FTTH: 'Surveyor FTTH', // FIX
  SURVEYOR_FTTB: 'Surveyor FTTB', // FIX
  SURVEYOR_FTTT: 'Surveyor FTTT', // FIX
  PM_FTTH: 'PM FTTH', // FIX
  PM_FTTB: 'PM FTTB', // FIX
  PM_FTTT: 'PM FTTT', // FIX
  PM_SENIOR: 'Senior PM', // FIX
  ADMIN: 'Admin', // FIX
  ADMIN_STOCK: 'Admin Stok', // FIX
  MARKETING: 'Marketing', // FIX
  MARKETING_HEAD: 'Kepala Marketing', // FIX
  OPERATIONAL_MANAGER: 'Ops Manager', // FIX
  GENERAL_MANAGER: 'General Manager', // FIX
  FINANCE: 'Finance', // FIX
  DESIGNER: 'Design Team', // FIX
}; // FIX

type HistoryEntry = {
  step: number; // FIX
  role: string; // FIX
  userId: string; // FIX
  action: string; // FIX
  notes?: string | null; // FIX
  timestamp: string; // FIX
}; // FIX

function parseHistory(json: Prisma.JsonValue | null | undefined): HistoryEntry[] {
  if (!json || !Array.isArray(json)) return []; // FIX
  return json as HistoryEntry[]; // FIX
} // FIX

function parseChain(json: Prisma.JsonValue | null | undefined): string[] {
  if (!json || !Array.isArray(json)) return []; // FIX
  return json.map((x) => String(x)); // FIX
} // FIX

/** FIX: amount > 1_000_000 requires GM (matches frontend) */
function isHighAmount(amount: number): boolean {
  return amount > 1_000_000; // FIX
} // FIX

/** FIX: insert GENERAL_MANAGER before FINANCE when high */
function withGM(chain: Role[], high: boolean): Role[] {
  if (!high) return chain; // FIX
  const financeIdx = chain.indexOf(Role.FINANCE); // FIX
  if (financeIdx === -1) return [...chain, Role.GENERAL_MANAGER]; // FIX
  const next = [...chain]; // FIX
  next.splice(financeIdx, 0, Role.GENERAL_MANAGER); // FIX
  return next; // FIX
} // FIX

/** FIX: full chain [submitter, …approvers…] — same order as frontend */
function buildApprovalChain(submitterRole: string, amount: number): Role[] {
  const high = isHighAmount(amount); // FIX
  const sr = submitterRole as Role; // FIX

  switch (submitterRole) {
    case Role.SURVEYOR_FTTH: // FIX
      return withGM(
        [Role.SURVEYOR_FTTH, Role.PM_FTTH, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], // FIX
        high, // FIX
      ); // FIX
    case Role.SURVEYOR_FTTB: // FIX
      return withGM(
        [Role.SURVEYOR_FTTB, Role.PM_FTTB, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], // FIX
        high, // FIX
      ); // FIX
    case Role.SURVEYOR_FTTT: // FIX
      return withGM(
        [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], // FIX
        high, // FIX
      ); // FIX
    case Role.PM_FTTH: // FIX
    case Role.PM_FTTB: // FIX
    case Role.PM_FTTT: // FIX
    case Role.PM_SENIOR: // FIX
      return withGM([sr, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], high); // FIX
    case Role.ADMIN: // FIX
    case Role.ADMIN_STOCK: // FIX
      return withGM([sr, Role.OPERATIONAL_MANAGER, Role.FINANCE], high); // FIX
    case Role.MARKETING: // FIX
      return withGM(
        [Role.MARKETING, Role.MARKETING_HEAD, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], // FIX
        high, // FIX
      ); // FIX
    case Role.MARKETING_HEAD: // FIX
      return withGM([Role.MARKETING_HEAD, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], high); // FIX
    case Role.OPERATIONAL_MANAGER: // FIX
      return [Role.OPERATIONAL_MANAGER, Role.GENERAL_MANAGER, Role.FINANCE]; // FIX
    case Role.FINANCE: // FIX
      return [Role.FINANCE, Role.OPERATIONAL_MANAGER, Role.GENERAL_MANAGER]; // FIX
    case Role.DESIGNER: // FIX
      return withGM(
        [Role.DESIGNER, Role.PM_SENIOR, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], // FIX
        high, // FIX
      ); // FIX
    case Role.GENERAL_MANAGER: // FIX
      return [Role.GENERAL_MANAGER, Role.FINANCE]; // FIX
    default: // FIX
      return withGM([sr, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE], high); // FIX
  }
} // FIX

function chainToJson(chain: Role[]): Prisma.InputJsonValue {
  return chain.map((r) => r as string) as unknown as Prisma.InputJsonValue; // FIX
} // FIX

// FIX: SLA deadline calculator
function calculateSlaDeadline(type: string, submittedAt: Date): Date {
  const businessDays = type === 'CASH_ADVANCE' ? 3 : 7; // FIX
  const deadline = new Date(submittedAt); // FIX
  let added = 0; // FIX
  while (added < businessDays) {
    deadline.setDate(deadline.getDate() + 1); // FIX
    const day = deadline.getDay(); // FIX
    if (day !== 0 && day !== 6) added += 1; // FIX
  }
  return deadline; // FIX
} // FIX

function isFinalStatus(status: CashOpStatus): boolean {
  return status === 'DISBURSED' || status === 'REJECTED' || status === 'CANCELLED'; // FIX
} // FIX

/** FIX: PM_SENIOR may act on PM_FTTH/PM_FTTB/PM_FTTT steps */
function roleCanActOnCashOpStep(approverRole: string, stepRole: string | null): boolean {
  const a = (approverRole ?? '').trim(); // FIX
  const s = (stepRole ?? '').trim(); // FIX
  if (!s) return false; // FIX
  if (a === s) return true; // FIX
  if (a === 'PM_SENIOR' && ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(s)) return true; // FIX
  return false; // FIX
} // FIX

@Injectable()
export class CashOperationService {
  private readonly logger = new Logger(CashOperationService.name); // FIX

  constructor(
    private readonly prisma: PrismaService, // FIX
    private readonly gateway: NotificationsGateway, // FIX
    private readonly storage: StorageService, // FIX
    private readonly notificationsService: NotificationsService, // FIX
    private readonly budgetLedger: BudgetLedgerService, // FIX
  ) {} // FIX

  private withApprovalDebug<
    T extends {
      id: string;
      approvalSteps: { status: string; approverRole: string }[];
      approvalChain: Prisma.JsonValue | null;
      currentApproverRole: string | null;
      currentStepRole: string | null;
    },
  >(row: T) {
    const chainParsed = parseChain(row.approvalChain);
    const expectedApprovalStepCount = Math.max(0, chainParsed.length - 1);
    const actualApprovalStepCount = row.approvalSteps.length;
    const pendingStepFound = row.approvalSteps.some((s) => s.status === 'PENDING');
    const chainOutOfSync = actualApprovalStepCount !== expectedApprovalStepCount;
    const currentRole = row.currentApproverRole ?? row.currentStepRole;
    const pendingMatchesCurrent =
      !currentRole ||
      row.approvalSteps.some((s) => s.status === 'PENDING' && s.approverRole === currentRole);
    let repairSuggestion: string | undefined;
    if (chainOutOfSync || !pendingMatchesCurrent) {
      this.logger.warn(
        `approvalDebug drift request=${row.id} steps=${actualApprovalStepCount} expected=${expectedApprovalStepCount} pendingStepFound=${pendingStepFound} currentRole=${currentRole ?? 'null'}`,
      );
      repairSuggestion =
        'Data langkah persetujuan tidak selaras dengan approvalChain. Minta admin memeriksa cashOpApprovalStep vs JSON approvalChain, atau kirim ulang submit dari DRAFT bila memungkinkan.';
    }
    return {
      ...row,
      approvalDebug: {
        currentApproverRole: currentRole,
        pendingStepFound,
        expectedApprovalStepCount,
        actualApprovalStepCount,
        ...(repairSuggestion ? { repairSuggestion } : {}),
      },
    };
  }

  private async nextRequestNumber(type: 'CASH_ADVANCE' | 'REIMBURSEMENT') {
    const year = new Date().getFullYear(); // FIX
    const prefix = type === 'CASH_ADVANCE' ? 'CA' : 'RM'; // FIX
    const count = await this.prisma.cashOperationRequest.count({
      where: {
        type, // FIX
        createdAt: { gte: new Date(`${year}-01-01`) }, // FIX
      },
    }); // FIX
    return `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`; // FIX
  } // FIX

  async create(dto: CreateCashOpDto, userId: string, userRole: string) {
    const opType = (dto.type || 'CASH_ADVANCE') as 'CASH_ADVANCE' | 'REIMBURSEMENT'; // FIX
    const requestNumber = await this.nextRequestNumber(opType); // FIX
    const amount = Number(dto.amount ?? dto.totalAmount ?? 0); // FIX
    const lineItems = dto.lineItems ?? []; // FIX
    const photoUrls: string[] = (dto.photoUrls ?? []).map((u) => String(u)); // FIX

    if (opType === 'REIMBURSEMENT' && photoUrls.length === 0) {
      throw new BadRequestException('Reimbursement memerlukan minimal 1 foto bukti'); // FIX
    }

    if (opType === 'CASH_ADVANCE') {
      if ((lineItems?.length ?? 0) > 0 || photoUrls.length > 0) {
        this.logger.warn(
          'Cash Advance Stage 1: lineItems/foto dari client tidak disimpan (kompatibilitas legacy / input deprecated)',
        );
      }
      if (!dto.nomorRekeningPengaju?.trim()) {
        throw new BadRequestException('Nomor rekening wajib diisi untuk pengajuan Cash Advance.');
      }
    }

    const baseDescription = String(dto.description?.trim?.() || dto.title?.trim?.() || '-').slice(0, 500); // FIX
    const description = dto.notes?.trim?.() // FIX
      ? `${baseDescription}\n\nCatatan: ${String(dto.notes).trim()}` // FIX
      : baseDescription; // FIX

    const chain = buildApprovalChain(userRole, amount); // FIX
    const totalSteps = Math.max(0, chain.length - 1); // FIX

    const isCa = opType === 'CASH_ADVANCE'; // M2
    const lineItemsPersist = isCa
      ? Prisma.JsonNull
      : ((lineItems.length ? lineItems : []) as Prisma.InputJsonValue); // FIX
    const photoUrlsPersist = isCa ? Prisma.JsonNull : ((photoUrls.length ? photoUrls : []) as Prisma.InputJsonValue); // FIX
    const attachmentsCreate =
      !isCa && photoUrls.length > 0 // FIX
        ? {
            create: photoUrls.map((url: string, i: number) => ({
              fileName: `bukti-${i + 1}`, // FIX
              fileUrl: url, // FIX
              uploadedBy: userId, // FIX
            })), // FIX
          } // FIX
        : undefined; // FIX

    return this.prisma.cashOperationRequest.create({
      data: {
        requestNumber, // FIX
        type: opType, // FIX
        requestedBy: userId, // FIX
        description, // FIX
        amount, // FIX
        category: dto.category ?? null, // FIX
        projectRef: dto.projectRef ?? null, // FIX
        financeProjectId: dto.financeProjectId?.trim() || null, // FIX
        status: 'DRAFT', // FIX
        lineItems: lineItemsPersist, // FIX
        totalAmount: dto.totalAmount ?? dto.amount ?? 0, // FIX
        photoUrls: photoUrlsPersist, // FIX
        periodeFrom: dto.periodeFrom ? new Date(dto.periodeFrom) : null, // M2 CA
        periodeTo: dto.periodeTo ? new Date(dto.periodeTo) : null, // M2 CA
        // Issue C: Requester's bank account number
        nomorRekeningPengaju: dto.nomorRekeningPengaju ?? null,
        fileUrl: dto.fileUrl ?? null, // FIX
        approvalChain: chainToJson(chain), // FIX
        approvalHistory: [] as unknown as Prisma.InputJsonValue, // FIX
        currentApproverRole: null, // FIX
        currentStep: 0, // FIX
        totalSteps, // FIX
        attachments: attachmentsCreate, // FIX
      }, // FIX
      include: {
        requester: { select: { id: true, name: true, role: true } }, // FIX
        attachments: true, // FIX
        approvalSteps: true, // FIX
      },
    }); // FIX
  } // FIX

  async submit(requestId: string, userId: string) {
    const req = await this.prisma.cashOperationRequest.findUnique({
      where: { id: requestId }, // FIX
      include: {
        requester: { select: { id: true, name: true, role: true } }, // FIX
        attachments: true, // FIX
      },
    }); // FIX
    if (!req) throw new NotFoundException('Request tidak ditemukan'); // FIX
    if (req.requestedBy !== userId) throw new ForbiddenException('Hanya pembuat request yang bisa submit'); // FIX
    if (req.status !== 'DRAFT') throw new BadRequestException('Hanya request DRAFT yang bisa disubmit'); // FIX

    const photoUrlCount = Array.isArray(req.photoUrls) ? req.photoUrls.length : 0; // FIX
    const hasProof = req.attachments.length >= 1 || photoUrlCount >= 1; // FIX
    if (req.type === 'REIMBURSEMENT' && !hasProof) {
      throw new BadRequestException('Minimal 1 lampiran wajib untuk reimbursement'); // FIX
    }

    if (req.type === 'CASH_ADVANCE') {
      // Issue B: Block only if CA is DISBURSED (can't create new CA while money is out)
      // REALISASI_IN_PROGRESS is allowed because realisasi has already been submitted
      const outstanding = await this.prisma.cashOperationRequest.findFirst({
        where: {
          requestedBy: userId,
          type: 'CASH_ADVANCE',
          status: 'DISBURSED', // Only block if money is actually disbursed
          id: { not: requestId }, // Don't block self
        },
      });

      if (outstanding) {
        throw new BadRequestException(
          `Pengajuan diblokir: Anda memiliki Cash Advance yang sedang dicairkan (${outstanding.requestNumber}). Tunggu hingga selesai direalisasi.`,
        );
      }

      if (!req.periodeFrom || !req.periodeTo) {
        throw new BadRequestException('Cash Advance harus memiliki periode penggunaan'); // M2
      }
      if (!req.nomorRekeningPengaju?.trim()) {
        throw new BadRequestException('Nomor rekening wajib diisi untuk pengajuan Cash Advance.');
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      if (req.periodeFrom < todayStart) {
        throw new BadRequestException('Periode mulai tidak boleh di masa lalu');
      }
      if (req.periodeTo < req.periodeFrom) {
        throw new BadRequestException('Periode selesai tidak boleh mendahului periode mulai');
      }
    }

    const amtDec = new Prisma.Decimal(req.amount); // FIX
    if (amtDec.lte(0)) {
      throw new BadRequestException('Nominal harus lebih dari 0'); // M2
    }

    const amt = amtDec.toNumber(); // FIX
    const chainRoles = buildApprovalChain(req.requester.role, amt); // FIX
    const chainStr = chainRoles.map((r) => r as string); // FIX
    const approverRoles = chainRoles.slice(1); // FIX
    const firstApprover = approverRoles[0] ?? null; // FIX
    const now = new Date(); // FIX
    const deadline = calculateSlaDeadline(req.type, now); // FIX

    const history: HistoryEntry[] = [
      {
        step: 0, // FIX
        role: req.requester.role, // FIX
        userId, // FIX
        action: 'SUBMITTED', // FIX
        notes: 'Pengajuan disubmit', // FIX
        timestamp: now.toISOString(), // FIX
      },
    ]; // FIX

    await this.prisma.$transaction([
      this.prisma.cashOpApprovalStep.deleteMany({ where: { requestId } }), // FIX
      this.prisma.cashOpApprovalStep.createMany({
        data: approverRoles.map((role, idx) => ({
          requestId, // FIX
          stepOrder: idx + 1, // FIX
          approverRole: role as string, // FIX
          status: 'PENDING' as StepStatus, // FIX
        })), // FIX
      }), // FIX
      this.prisma.cashOperationRequest.update({
        where: { id: requestId }, // FIX
        data: {
          status: 'SUBMITTED', // FIX
          currentStepRole: firstApprover, // FIX
          currentApproverRole: firstApprover, // FIX
          currentStep: firstApprover ? 1 : 0, // FIX
          totalSteps: Math.max(0, chainStr.length - 1), // FIX
          approvalChain: chainStr as unknown as Prisma.InputJsonValue, // FIX
          approvalHistory: history as unknown as Prisma.InputJsonValue, // FIX
          slaDeadline: deadline, // FIX
          slaBreached: false, // FIX
        },
      }),
    ]); // FIX

    const postSubmit = await this.prisma.cashOperationRequest.findUnique({
      where: { id: requestId },
      include: { approvalSteps: { orderBy: { stepOrder: 'asc' } } },
    });
    const steps = postSubmit?.approvalSteps;
    if (postSubmit && Array.isArray(steps)) {
      const chainParsed = parseChain(postSubmit.approvalChain);
      const expectedSteps = Math.max(0, chainParsed.length - 1);
      if (steps.length !== expectedSteps) {
        this.logger.error(
          `submit(${requestId}): approvalSteps=${steps.length} expected=${expectedSteps} chainLen=${chainParsed.length}`,
        );
        throw new BadRequestException(
          'Inisialisasi alur persetujuan tidak valid. Hubungi administrator.',
        );
      }
      const firstPending = steps.find((s) => s.status === 'PENDING');
      const expectedFirstRole = firstApprover ?? null;
      if (expectedFirstRole && firstPending && firstPending.approverRole !== expectedFirstRole) {
        this.logger.error(
          `submit(${requestId}): first pending step role ${firstPending.approverRole} !== currentApprover ${expectedFirstRole}`,
        );
        throw new BadRequestException(
          'Inisialisasi alur persetujuan tidak valid. Hubungi administrator.',
        );
      }
    } else {
      this.logger.warn(`submit(${requestId}): post-submit approvalSteps not loaded; skipping step-count verify`);
    }

    if (firstApprover) {
      this.gateway.emitToRoom(`role:${firstApprover}`, 'cashOp:newRequest', {
        id: req.id, // FIX
        requestNumber: req.requestNumber, // FIX
        type: req.type, // FIX
        amount: amt, // FIX
        requesterName: req.requester.name, // FIX
        description: req.description, // FIX
      }); // FIX

      const typeLabel = req.type === 'CASH_ADVANCE' ? 'Cash Advance' : 'Reimbursement'; // FIX
      await this.notificationsService.notifyUsersByRole(firstApprover as Role, {
        title: 'Cash Operation Baru', // FIX
        message: `${req.requester.name} — ${req.requestNumber} — ${typeLabel} Rp ${amt.toLocaleString('id-ID')}`, // FIX
        link: `/cash-operation/${req.id}`, // FIX
        type: 'CASH_OPERATION', // FIX
        entityId: req.id, // FIX
      }); // FIX
    }

    return this.findOne(requestId, userId, req.requester.role); // FIX
  } // FIX

  async rejectRequest(requestId: string, approverId: string, approverRole: string, notes: string) {
    const dto: ApproveStepDto = { action: 'REJECT', notes: notes || 'Ditolak' }; // FIX
    return this.approve(requestId, dto, approverId, approverRole); // FIX
  } // FIX

  async approve(requestId: string, dto: ApproveStepDto, approverId: string, approverRole: string) {
    const req = await this.prisma.cashOperationRequest.findUnique({
      where: { id: requestId }, // FIX
      include: {
        approvalSteps: { orderBy: { stepOrder: 'asc' } }, // FIX
        requester: { select: { id: true, name: true, role: true } }, // FIX
      },
    }); // FIX
    if (!req) throw new NotFoundException('Request tidak ditemukan'); // FIX

    let chain = parseChain(req.approvalChain); // FIX
    if (chain.length === 0) {
      chain = buildApprovalChain(req.requester.role, Number(req.amount)).map((r) => r as string); // FIX
    }

    const chainIdx = req.currentStep > 0 ? req.currentStep : 1; // FIX
    const expectedRole = chain[chainIdx] ?? req.currentStepRole; // FIX

    if (!expectedRole) throw new BadRequestException('Request tidak memiliki step aktif'); // FIX
    if (!roleCanActOnCashOpStep(approverRole, expectedRole)) {
      throw new ForbiddenException(
        `Bukan giliran role Anda — menunggu ${ROLE_LABELS[expectedRole] || expectedRole}`, // FIX
      ); // FIX
    }

    const currentStepRow = req.approvalSteps.find(
      (s) => s.approverRole === expectedRole && s.status === 'PENDING', // FIX
    ); // FIX
    if (!currentStepRow) throw new BadRequestException('Step aktif tidak ditemukan'); // FIX

    if (dto.action === 'REJECT') {
      const hist = parseHistory(req.approvalHistory); // FIX
      hist.push({
        step: chainIdx, // FIX
        role: approverRole, // FIX
        userId: approverId, // FIX
        action: 'REJECTED', // FIX
        notes: dto.notes ?? null, // FIX
        timestamp: new Date().toISOString(), // FIX
      }); // FIX

      await this.prisma.$transaction([
        this.prisma.cashOpApprovalStep.update({
          where: { id: currentStepRow.id }, // FIX
          data: {
            status: 'REJECTED', // FIX
            approverId, // FIX
            notes: dto.notes, // FIX
            decidedAt: new Date(), // FIX
          },
        }), // FIX
        this.prisma.cashOperationRequest.update({
          where: { id: requestId }, // FIX
          data: {
            status: 'REJECTED', // FIX
            rejectionReason: dto.notes ?? null, // FIX
            currentStepRole: null, // FIX
            currentApproverRole: null, // FIX
            slaBreached: req.slaDeadline ? new Date() > req.slaDeadline : false, // FIX
            approvalHistory: hist as unknown as Prisma.InputJsonValue, // FIX
          },
        }),
      ]); // FIX

      this.gateway.emitToRoom(`user:${req.requestedBy}`, 'cashOp:rejected', {
        id: req.id, // FIX
        requestNumber: req.requestNumber, // FIX
        reason: dto.notes ?? null, // FIX
      }); // FIX

      await this.notificationsService.createForUser(req.requestedBy, {
        title: 'Cash Operation Ditolak', // FIX
        message: `${req.requestNumber} ditolak. ${dto.notes ?? ''}`, // FIX
        type: 'CASH_OPERATION', // FIX
        link: `/cash-operation/${req.id}`, // FIX
        entityId: req.id, // FIX
      }); // FIX

      return this.findOne(requestId, req.requestedBy, approverRole); // FIX
    }

    const now = new Date(); // FIX
    const hist = parseHistory(req.approvalHistory); // FIX
    hist.push({
      step: chainIdx, // FIX
      role: approverRole, // FIX
      userId: approverId, // FIX
      action: 'APPROVED', // FIX
      notes: dto.notes ?? '', // FIX
      timestamp: now.toISOString(), // FIX
    }); // FIX

    const nextIdx = chainIdx + 1; // FIX
    const isDone = nextIdx >= chain.length; // FIX
    const nextRole = !isDone ? chain[nextIdx] : null; // FIX

    let budgetNotify: {
      projectId: string;
      prevUtil: UtilizationPair;
      actorId: string;
      creatorId: string | null;
      amount: Prisma.Decimal;
    } | null = null;

    await runSerializableTransaction(this.prisma, async (tx) => {
      const previousApprovedSteps = await tx.cashOpApprovalStep.findMany({
        where: {
          requestId,
          status: 'APPROVED',
          stepOrder: { lt: currentStepRow.stepOrder },
        },
        orderBy: { stepOrder: 'desc' },
        take: 1,
      });

      const ceiling =
        previousApprovedSteps[0]?.approvedAmount != null
          ? new Prisma.Decimal(previousApprovedSteps[0].approvedAmount)
          : new Prisma.Decimal(req.amount);

      const approvedAmount =
        dto.approvedAmount != null ? new Prisma.Decimal(dto.approvedAmount) : new Prisma.Decimal(ceiling);

      if (approvedAmount.lte(0)) {
        throw new BadRequestException('Nominal disetujui harus lebih dari 0'); // FIX
      }
      if (approvedAmount.gt(ceiling)) {
        throw new BadRequestException(
          `Nominal disetujui (Rp ${approvedAmount.toFixed(0)}) tidak boleh melebihi nominal step sebelumnya (Rp ${ceiling.toFixed(0)})`, // FIX
        ); // FIX
      }

      await tx.cashOpApprovalStep.update({
        where: { id: currentStepRow.id }, // FIX
        data: {
          status: 'APPROVED', // FIX
          approvedAmount, // FIX
          approverId, // FIX
          notes: dto.notes, // FIX
          decidedAt: now, // FIX
        },
      }); // FIX

      if (!isDone) {
        const nextStatus: CashOpStatus = 'IN_REVIEW'; // FIX
        await tx.cashOperationRequest.update({
          where: { id: requestId }, // FIX
          data: {
            status: nextStatus, // FIX
            currentStepRole: nextRole, // FIX
            currentApproverRole: nextRole, // FIX
            currentStep: nextIdx, // FIX
            slaBreached: req.slaDeadline ? now > req.slaDeadline : false, // FIX
            approvalHistory: hist as unknown as Prisma.InputJsonValue, // FIX
          },
        }); // FIX
        return; // FIX
      }

      const row = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: requestId } }); // FIX
      const finalApprovedAmount = approvedAmount; // FIX

      if (finalApprovedAmount.gt(0)) {
        const projectId = await this.budgetLedger.resolveProjectId(row.financeProjectId, tx); // FIX
        const fp = await tx.financeProject.findUniqueOrThrow({ where: { id: projectId } }); // FIX
        const prevUtil = this.budgetLedger.utilizationFromProject(fp); // FIX

        if (row.type === 'REIMBURSEMENT') {
          const requestAmount = new Prisma.Decimal(row.amount); // FIX
          await this.budgetLedger.deductForCashOp(
            requestId,
            projectId,
            requestAmount,
            approverId,
            row.requestedBy,
            tx,
          ); // FIX
          const variance = requestAmount.minus(finalApprovedAmount); // FIX
          if (variance.gt(0)) {
            await this.budgetLedger.partialRefundForCashOp(
              requestId,
              variance,
              `Selisih request vs final approved: Rp ${requestAmount.toFixed(0)} - Rp ${finalApprovedAmount.toFixed(0)}`, // FIX
              approverId,
              CashOpPartialRefundType.REIMBURSEMENT_VARIANCE,
              tx,
            ); // FIX
          }
        } else {
          await this.budgetLedger.deductForCashOp(
            requestId,
            projectId,
            finalApprovedAmount,
            approverId,
            row.requestedBy,
            tx,
          ); // FIX
        }

        budgetNotify = {
          projectId, // FIX
          prevUtil, // FIX
          actorId: approverId, // FIX
          creatorId: row.requestedBy, // FIX
          amount: finalApprovedAmount, // FIX
        }; // FIX
      } else {
        this.logger.warn(`CashOp ${requestId}: nominal disetujui tidak > 0, lewati pemotongan budget`); // FIX
      }

      await tx.cashOperationRequest.update({
        where: { id: requestId }, // FIX
        data: {
          status: 'APPROVED', // FIX
          finalApprovedAmount, // FIX
          approvedAt: now, // FIX
          currentStepRole: null, // FIX
          currentApproverRole: null, // FIX
          currentStep: chain.length - 1, // FIX
          slaBreached: req.slaDeadline ? now > req.slaDeadline : false, // FIX
          approvalHistory: hist as unknown as Prisma.InputJsonValue, // FIX
        },
      }); // FIX
    }); // FIX

    if (budgetNotify) {
      await this.budgetLedger.afterDeductNotifyCashOp(
        budgetNotify.projectId,
        budgetNotify.prevUtil,
        budgetNotify.actorId,
        budgetNotify.creatorId,
        budgetNotify.amount,
      ); // FIX
    }

    if (isDone) {
      this.gateway.emitToRoom(`user:${req.requestedBy}`, 'cashOp:fullyApproved', {
        id: req.id, // FIX
        requestNumber: req.requestNumber, // FIX
      }); // FIX
      this.gateway.emitToRoom('role:FINANCE', 'cashOp:fullyApproved', {
        id: req.id, // FIX
        requestNumber: req.requestNumber, // FIX
      }); // FIX

      await this.notificationsService.notifyUsersByRole(Role.FINANCE, {
        title: 'Cash Operation disetujui', // FIX
        message: `${req.requestNumber} telah melewati semua approval.`, // FIX
        link: `/cash-operation/${req.id}`, // FIX
        type: 'CASH_OPERATION', // FIX
        entityId: req.id, // FIX
      }); // FIX

      await this.notificationsService.createForUser(req.requestedBy, {
        title: 'Cash Operation disetujui', // FIX
        message: `${req.requestNumber} telah disetujui semua pihak.`, // FIX
        type: 'CASH_OPERATION', // FIX
        link: `/cash-operation/${req.id}`, // FIX
        entityId: req.id, // FIX
      }); // FIX
    } else {
      if (nextRole) {
        this.gateway.emitToRoom(`role:${nextRole}`, 'cashOp:pendingApproval', {
          id: req.id, // FIX
          requestNumber: req.requestNumber, // FIX
        }); // FIX
        await this.notificationsService.notifyUsersByRole(nextRole as Role, {
          title: 'Cash Operation — perlu approval', // FIX
          message: `Request ${req.requestNumber} menunggu approval ${ROLE_LABELS[nextRole] || nextRole}`, // FIX
          link: `/cash-operation/${req.id}`, // FIX
          type: 'CASH_OPERATION', // FIX
          entityId: req.id, // FIX
        }); // FIX
      }
    }

    this.gateway.emitToRoom(`user:${req.requestedBy}`, 'cashOp:approved', {
      id: req.id, // FIX
      requestNumber: req.requestNumber, // FIX
    }); // FIX

    return this.findOne(requestId, req.requestedBy, approverRole); // FIX

  } // FIX

  async disburse(requestId: string, dto: DisburseDto, financeUserId: string, financeRole: string) {
    if (financeRole !== 'FINANCE') throw new ForbiddenException('Hanya Finance dapat mencairkan'); // FIX
    const row = await this.prisma.cashOperationRequest.findUnique({ where: { id: requestId } }); // FIX
    if (!row) throw new NotFoundException('Request tidak ditemukan'); // FIX
    if (row.status !== 'APPROVED') throw new BadRequestException('Request belum siap dicairkan'); // FIX

    if (row.finalApprovedAmount != null) {
      throw new BadRequestException(
        row.type === 'CASH_ADVANCE'
          ? 'Cash Advance flow baru tidak memerlukan pencairan terpisah. Lanjutkan ke laporan realisasi setelah periode selesai.' // FIX
          : 'Reimbursement otomatis disetujui setelah approval, tidak perlu pencairan terpisah.', // FIX
      ); // FIX
    }

    const updated = await this.prisma.cashOperationRequest.update({
      where: { id: requestId }, // FIX
      data: {
        status: 'DISBURSED', // FIX
        disbursedAt: new Date(), // FIX
        disbursedAmount: dto.disbursedAmount, // FIX
        financeNotes: dto.notes, // FIX
      }, // FIX
      include: {
        requester: { select: { id: true, name: true, role: true } }, // FIX
        attachments: true, // FIX
        approvalSteps: { include: { approver: { select: { id: true, name: true, role: true } } }, orderBy: { stepOrder: 'asc' } }, // FIX
      },
    }); // FIX

    this.gateway.emitToRoom(`user:${updated.requestedBy}`, 'cashOp:disbursed', {
      id: updated.id, // FIX
      requestNumber: updated.requestNumber, // FIX
      amount: Number(updated.disbursedAmount ?? 0), // FIX
      disbursedAt: updated.disbursedAt, // FIX
      by: financeUserId, // FIX
    }); // FIX
    await this.notificationsService.createForUser(updated.requestedBy, {
      title: 'Dana dicairkan', // FIX
      message: `${updated.requestNumber} — Rp ${Number(updated.disbursedAmount ?? 0).toLocaleString('id-ID')} telah dicairkan`, // FIX
      type: 'CASH_OPERATION', // FIX
      link: `/cash-operation/${updated.id}`, // FIX
      entityId: updated.id, // FIX
    }); // FIX
    return updated; // FIX
  } // FIX

  async uploadAttachment(requestId: string, fileData: UploadAttachmentDto, userId: string) {
    const req = await this.prisma.cashOperationRequest.findUnique({ where: { id: requestId } }); // FIX
    if (!req) throw new NotFoundException('Request tidak ditemukan'); // FIX
    if (req.requestedBy !== userId) throw new ForbiddenException('Bukan request milik Anda'); // FIX
    if (req.status !== 'DRAFT') throw new BadRequestException('Lampiran hanya bisa diubah saat DRAFT'); // FIX
    return this.prisma.cashOpAttachment.create({
      data: {
        requestId, // FIX
        fileName: fileData.fileName, // FIX
        fileUrl: fileData.fileUrl, // FIX
        fileSize: fileData.fileSize, // FIX
        mimeType: fileData.mimeType, // FIX
        uploadedBy: userId, // FIX
      },
    }); // FIX
  } // FIX

  async update(id: string, dto: Record<string, unknown>, userId: string) {
    const req = await this.prisma.cashOperationRequest.findUnique({
      where: { id },
      include: { requester: { select: { role: true } } },
    });
    if (!req) throw new NotFoundException('Request tidak ditemukan');
    if (req.requestedBy !== userId) throw new ForbiddenException('Hanya pembuat yang bisa edit');
    if (req.status !== 'REJECTED') {
      throw new BadRequestException('Hanya request yang ditolak yang bisa diedit');
    }

    const amount = Number((dto as { totalAmount?: unknown; amount?: unknown }).totalAmount ?? (dto as { amount?: unknown }).amount ?? req.amount);
    const rawTitle = (dto as { title?: unknown; description?: unknown }).title ?? (dto as { description?: unknown }).description ?? req.description;
    const baseDescription = String(rawTitle ?? '-').slice(0, 500);
    const notesRaw = (dto as { notes?: unknown }).notes;
    const fullDesc =
      notesRaw != null && String(notesRaw).trim() !== ''
        ? `${baseDescription}\n\nCatatan: ${String(notesRaw).trim()}`
        : baseDescription;

    const lineItems = (dto as { lineItems?: unknown }).lineItems;
    const lineItemsArr = Array.isArray(lineItems) ? lineItems : [];
    const photoRaw = (dto as { photoUrls?: unknown }).photoUrls;
    const photoUrls: string[] = Array.isArray(photoRaw) ? photoRaw.map((u) => String(u)) : [];

    if (req.type === 'REIMBURSEMENT' && photoUrls.length === 0) {
      throw new BadRequestException('Reimbursement memerlukan minimal 1 foto bukti');
    }

    const chain = buildApprovalChain(req.requester.role, amount);
    const chainStr = chain.map((r) => r as string);

    const periodeFromRaw = (dto as { periodeFrom?: unknown }).periodeFrom;
    const periodeToRaw = (dto as { periodeTo?: unknown }).periodeTo;
    const isCa = req.type === 'CASH_ADVANCE';

    await this.prisma.$transaction(async (tx) => {
      await tx.cashOpApprovalStep.deleteMany({ where: { requestId: id } });
      await tx.cashOpAttachment.deleteMany({ where: { requestId: id } });
      await tx.cashOperationRequest.update({
        where: { id },
        data: {
          description: fullDesc,
          amount,
          totalAmount: amount,
          approvalChain: chainStr as unknown as Prisma.InputJsonValue,
          approvalHistory: [] as unknown as Prisma.InputJsonValue,
          totalSteps: Math.max(0, chainStr.length - 1),
          currentStep: 0,
          currentStepRole: null,
          currentApproverRole: null,
          status: 'DRAFT',
          rejectionReason: null,
          slaDeadline: null,
          slaBreached: false,
          ...(isCa
            ? {
                lineItems: Prisma.JsonNull,
                photoUrls: Prisma.JsonNull,
                periodeFrom: periodeFromRaw ? new Date(String(periodeFromRaw)) : null,
                periodeTo: periodeToRaw ? new Date(String(periodeToRaw)) : null,
              }
            : {
                lineItems: (lineItemsArr.length ? lineItemsArr : []) as Prisma.InputJsonValue,
                photoUrls: photoUrls as unknown as Prisma.InputJsonValue,
              }),
          ...(photoUrls.length > 0
            ? {
                attachments: {
                  create: photoUrls.map((url, i) => ({
                    fileName: `bukti-${i + 1}`,
                    fileUrl: url,
                    uploadedBy: userId,
                  })),
                },
              }
            : {}),
        },
      });
    });

    return this.findOne(id, userId, req.requester.role);
  }

  async deleteAttachment(requestId: string, attachmentId: string, userId: string, userRole: string) {
    const attachment = await this.prisma.cashOpAttachment.findUnique({
      where: { id: attachmentId }, // FIX
      include: { request: true }, // FIX
    }); // FIX
    if (!attachment || attachment.requestId !== requestId) throw new NotFoundException('Lampiran tidak ditemukan'); // FIX
    if (attachment.request.status !== 'DRAFT') throw new BadRequestException('Lampiran hanya bisa dihapus saat DRAFT'); // FIX
    const isOwner = attachment.uploadedBy === userId; // FIX
    const isAdmin = userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER'; // FIX
    if (!isOwner && !isAdmin) throw new ForbiddenException('Tidak memiliki akses menghapus lampiran'); // FIX
    await this.prisma.cashOpAttachment.delete({ where: { id: attachmentId } }); // FIX
    return { success: true }; // FIX
  } // FIX

  async getPresignedUpload(fileName: string, contentType: string) {
    const key = `cash-op/${new Date().getFullYear()}/${Date.now()}-${fileName}`; // FIX
    const uploadUrl = await this.storage.generatePresignedUrl(key, contentType); // FIX
    const endpointUrl = process.env.S3_ENDPOINT || `https://s3.${process.env.AWS_REGION}.amazonaws.com`; // FIX
    const fileUrl = `${endpointUrl}/${process.env.AWS_BUCKET_NAME || 'permatrack-documents'}/${key}`; // FIX
    return { uploadUrl, fileUrl }; // FIX
  } // FIX

  /** FIX: inbox list — same visibility as inbox-count */
  async getInboxList(userId: string, userRole: string) {
    const where: Prisma.CashOperationRequestWhereInput =
      userRole === 'PM_SENIOR' // FIX
        ? {
            status: { in: ['SUBMITTED', 'IN_REVIEW'] }, // FIX
            currentStepRole: { in: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR'] }, // FIX
          } // FIX
        : {
            status: { in: ['SUBMITTED', 'IN_REVIEW'] }, // FIX
            currentStepRole: userRole, // FIX
          }; // FIX

    const data = await this.prisma.cashOperationRequest.findMany({
      where, // FIX
      orderBy: { createdAt: 'desc' }, // FIX
      take: 100, // FIX
      include: {
        requester: { select: { id: true, name: true, role: true } }, // FIX
        attachments: true, // FIX
        approvalSteps: { orderBy: { stepOrder: 'asc' } }, // FIX
        financeProject: { select: { id: true, code: true, name: true } }, // FIX
      },
    }); // FIX
    return { data, total: data.length }; // FIX
  } // FIX

  async findAll(filters: FilterCashOpDto, userId: string, userRole: string) {
    const { page, limit, type, status, dateFrom, dateTo } = filters; // FIX
    const skip = (page - 1) * limit; // FIX
    const where: Prisma.CashOperationRequestWhereInput = {}; // FIX

    if (type) where.type = type; // FIX
    if (status) where.status = status as CashOpStatus; // FIX
    if (dateFrom || dateTo) {
      where.createdAt = {}; // FIX
      if (dateFrom) where.createdAt.gte = new Date(dateFrom); // FIX
      if (dateTo) where.createdAt.lte = new Date(dateTo); // FIX
    }

    const submitterOnly =
      userRole.startsWith('SURVEYOR_') || userRole === 'MARKETING' || userRole === 'DESIGNER'; // FIX
    if (submitterOnly) {
      where.requestedBy = userId; // FIX
    } else if (userRole === 'PM_SENIOR') {
      where.OR = [
        { requestedBy: userId }, // FIX
        { currentStepRole: userRole }, // FIX
        {
          AND: [
            { status: { in: ['SUBMITTED', 'IN_REVIEW'] } }, // FIX
            { currentStepRole: { in: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'] } }, // FIX
          ],
        },
      ]; // FIX
    } else if (userRole.startsWith('PM_') || userRole === 'MARKETING_HEAD') {
      where.OR = [{ requestedBy: userId }, { currentStepRole: userRole }]; // FIX
    } // FIX

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cashOperationRequest.findMany({
        where, // FIX
        skip, // FIX
        take: limit, // FIX
        orderBy: { createdAt: 'desc' }, // FIX
        include: {
          requester: { select: { id: true, name: true, role: true } }, // FIX
          attachments: true, // FIX
          approvalSteps: {
            include: { approver: { select: { id: true, name: true, role: true } } }, // FIX
            orderBy: { stepOrder: 'asc' }, // FIX
          },
          financeProject: { select: { id: true, code: true, name: true } }, // FIX
        },
      }),
      this.prisma.cashOperationRequest.count({ where }),
    ]); // FIX

    const now = new Date(); // FIX
    await Promise.all(
      rows
        .filter((r) => r.slaDeadline && !isFinalStatus(r.status) && now > (r.slaDeadline as Date) && !r.slaBreached)
        .map((r) =>
          this.prisma.cashOperationRequest.update({
            where: { id: r.id }, // FIX
            data: { slaBreached: true }, // FIX
          }),
        ),
    ); // FIX

    return paginate(rows, total, page, limit); // FIX
  } // FIX

  async findOne(id: string, userId: string, userRole: string) {
    const row = await this.prisma.cashOperationRequest.findUnique({
      where: { id }, // FIX
      include: {
        requester: { select: { id: true, name: true, role: true } }, // FIX
        attachments: true, // FIX
        approvalSteps: {
          include: { approver: { select: { id: true, name: true, role: true } } }, // FIX
          orderBy: { stepOrder: 'asc' }, // FIX
        },
        financeProject: { select: { id: true, code: true, name: true } }, // FIX
      },
    }); // FIX
    if (!row) throw new NotFoundException('Request tidak ditemukan'); // FIX

    const privileged = ['ADMIN', 'ADMIN_STOCK', 'GENERAL_MANAGER', 'FINANCE', 'OPERATIONAL_MANAGER'].includes(userRole); // FIX
    if (privileged) return this.withApprovalDebug(row); // FIX

    const submitterOnly =
      userRole.startsWith('SURVEYOR_') || userRole === 'MARKETING' || userRole === 'DESIGNER'; // FIX
    if (submitterOnly && row.requestedBy !== userId) throw new ForbiddenException('Akses ditolak'); // FIX
    if (submitterOnly) return this.withApprovalDebug(row); // FIX

    const stepped = row.approvalSteps.some((s) => s.approverId === userId); // FIX
    if (userRole.startsWith('PM_') || userRole === 'MARKETING_HEAD') {
      const seniorPmQueue =
        userRole === 'PM_SENIOR' &&
        row.status !== 'DRAFT' &&
        ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(row.currentStepRole ?? ''); // FIX
      if (
        row.requestedBy === userId ||
        row.currentStepRole === userRole ||
        stepped ||
        seniorPmQueue ||
        roleCanActOnCashOpStep(userRole, row.currentStepRole)
      ) {
        return this.withApprovalDebug(row); // FIX
      }
      throw new ForbiddenException('Akses ditolak'); // FIX
    }
    throw new ForbiddenException('Akses ditolak'); // FIX
  } // FIX

  /**
   * Admin repair: recreate cashOpApprovalStep rows from approvalChain (or rebuild chain from amount).
   * Only when no step is APPROVED yet — avoids wiping partial approvals.
   */
  async repairApprovalFromChain(id: string, actorId: string, actorRole: string) {
    if (!['ADMIN', 'GENERAL_MANAGER', 'FINANCE'].includes(actorRole)) {
      throw new ForbiddenException('Hanya Admin / GM / Finance yang dapat memperbaiki alur approval');
    }
    const req = await this.prisma.cashOperationRequest.findUnique({
      where: { id },
      include: {
        approvalSteps: { orderBy: { stepOrder: 'asc' } },
        requester: { select: { id: true, name: true, role: true } },
      },
    });
    if (!req) throw new NotFoundException('Request tidak ditemukan');
    if (!['SUBMITTED', 'IN_REVIEW'].includes(req.status)) {
      throw new BadRequestException(
        'Perbaikan alur hanya untuk pengajuan berstatus SUBMITTED atau IN_REVIEW',
      );
    }
    const hasApproved = req.approvalSteps.some((s) => s.status === 'APPROVED');
    if (hasApproved) {
      throw new BadRequestException(
        'Tidak dapat memperbaiki otomatis: sudah ada step yang disetujui. Selesaikan alur atau reset pengajuan sesuai prosedur internal.',
      );
    }

    let chain = parseChain(req.approvalChain);
    if (chain.length === 0) {
      chain = buildApprovalChain(req.requester.role, Number(req.amount)).map((r) => r as string);
    }
    const approverRoles = chain.slice(1);
    const firstApprover = approverRoles[0] ?? null;

    await this.prisma.$transaction([
      this.prisma.cashOpApprovalStep.deleteMany({ where: { requestId: id } }),
      this.prisma.cashOpApprovalStep.createMany({
        data: approverRoles.map((role, idx) => ({
          requestId: id,
          stepOrder: idx + 1,
          approverRole: role as string,
          status: 'PENDING' as StepStatus,
        })),
      }),
      this.prisma.cashOperationRequest.update({
        where: { id },
        data: {
          approvalChain: chain as unknown as Prisma.InputJsonValue,
          currentStepRole: firstApprover,
          currentApproverRole: firstApprover,
          currentStep: firstApprover ? 1 : 0,
          totalSteps: Math.max(0, chain.length - 1),
        },
      }),
    ]);

    this.logger.warn(
      `repairApprovalFromChain: request=${id} actor=${actorId} role=${actorRole} stepsCreated=${approverRoles.length}`,
    );
    return this.findOne(id, actorId, actorRole);
  }

  async getInboxCount(userRole: string) {
    if (userRole === 'PM_SENIOR') {
      const count = await this.prisma.cashOperationRequest.count({
        where: {
          status: { in: ['SUBMITTED', 'IN_REVIEW'] }, // FIX
          currentStepRole: { in: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'] }, // FIX
        },
      }); // FIX
      return { count }; // FIX
    }
    const count = await this.prisma.cashOperationRequest.count({
      where: {
        currentStepRole: userRole, // FIX
        status: { in: ['SUBMITTED', 'IN_REVIEW'] }, // FIX
      },
    }); // FIX
    return { count }; // FIX
  } // FIX

  async getDashboardStats(userId: string, userRole: string) {
    const where: Prisma.CashOperationRequestWhereInput = {}; // FIX
    const submitterOnly =
      userRole.startsWith('SURVEYOR_') || userRole === 'MARKETING' || userRole === 'DESIGNER'; // FIX
    if (submitterOnly) where.requestedBy = userId; // FIX

    const [pending, approved, rejected, slaBreached, amountAgg] = await Promise.all([
      this.prisma.cashOperationRequest.count({ where: { ...where, status: { in: ['SUBMITTED', 'IN_REVIEW'] } } }), // FIX
      this.prisma.cashOperationRequest.count({ where: { ...where, status: 'APPROVED' } }), // FIX
      this.prisma.cashOperationRequest.count({ where: { ...where, status: 'REJECTED' } }), // FIX
      this.prisma.cashOperationRequest.count({ where: { ...where, slaBreached: true } }), // FIX
      this.prisma.cashOperationRequest.aggregate({ where, _sum: { amount: true } }), // FIX
    ]); // FIX

    return {
      pending, // FIX
      approved, // FIX
      rejected, // FIX
      slaBreached, // FIX
      totalAmount: Number(amountAgg._sum.amount ?? 0), // FIX
    }; // FIX
  } // FIX
} // FIX
