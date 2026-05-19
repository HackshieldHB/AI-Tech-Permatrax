import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import type { BaOpenService } from '../ba-open/ba-open.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import {
  CreateVisitRequestDtoType,
  PmVisitReviewDtoType,
  ReviewVisitRequestDtoType,
  SubmitSurveyDataDtoType,
  VisitRequestFilterDtoType,
  PatchVisitDraftDto,
  PatchVisitRejectedSurveyDto,
} from './visit-request.dto';
import { ApprovalAction, FiberType, Role, VisitRequestStatus } from '@prisma/client';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';

function pmRoleFromFiberType(ft: string): Role {
  if (ft === 'FTTB') return Role.PM_FTTB;
  if (ft === 'FTTT') return Role.PM_FTTT;
  return Role.PM_FTTH;
}

@Injectable()
export class VisitRequestService {
  private readonly logger = new Logger(VisitRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async create(dto: CreateVisitRequestDtoType, requestedBy: string) {
    const cleanList = await this.prisma.cleanList.findUnique({
      where: { id: dto.cleanListId },
    });
    if (!cleanList) throw new NotFoundException('Clean list tidak ditemukan');
    if (cleanList.status !== 'AVAILABLE') {
      throw new ConflictException(
        `Cluster ini tidak tersedia (status: ${cleanList.status})`,
      );
    }

    const active = await this.prisma.visitRequest.findFirst({
      where: {
        cleanListId: dto.cleanListId,
        status: { notIn: ['REJECTED', 'EXISTING_FIBER'] },
      },
    });
    if (active) {
      throw new ConflictException('Sudah ada visit request aktif untuk cluster ini');
    }

    const visitRequest = await this.prisma.visitRequest.create({
      data: {
        cleanListId: dto.cleanListId,
        fiberType: dto.fiberType,
        visitDate: new Date(dto.visitDate),
        surveyNotes: dto.surveyNotes ?? null,
        requestedBy,
        ispCustomer: cleanList.ispCustomer,
        status: 'DRAFT',
        evidencePhotos: [],
      },
    });

    // FIX: Auto-create PermitCluster at CLUSTER_INTAKE phase when visit request is created
    // PermitCluster creation is a side effect — if it fails, log the error but still return success for the Visit Request creation
    try {
      await this.permitCluster.initClusterForVisitRequest(visitRequest.id, requestedBy);
    } catch (clusterError: any) {
      this.logger.warn(`PermitCluster creation failed for visit request ${visitRequest.id}: ${clusterError.message}`);
      // Continue - Visit Request is the primary entity, PermitCluster is a side effect
    }

    await this.prisma.cleanList.update({
      where: { id: dto.cleanListId },
      data: { status: 'IN_PROGRESS' },
    });

    return visitRequest;
  }

  /** Visit schedule gate: PM_REVIEW_VISIT → APPROVED_PENDING_DATA | DRAFT (reject jadwal) */
  async pmVisitReview(id: string, dto: PmVisitReviewDtoType, pmUserId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.status !== 'PM_REVIEW_VISIT') {
      throw new ConflictException(`Status tidak valid untuk review jadwal kunjungan: ${vr.status}`);
    }

    const fiberPmRole = pmRoleFromFiberType(String(vr.fiberType));
    const siteLabel = vr.cleanList?.rwCode ?? vr.ispCustomer ?? id;

    if (dto.action === 'APPROVE') {
      const updatedRows = await this.prisma.$transaction(async (tx) => {
        const cnt = await tx.visitRequest.updateMany({
          where: { id, status: 'PM_REVIEW_VISIT' },
          data: {
            status: 'APPROVED_PENDING_DATA',
            visitGateApprovedAt: new Date(),
            visitGateApprovedBy: pmUserId,
            rejectionReason: null,
          },
        });
        if (cnt.count !== 1) {
          throw new ConflictException('Visit request sudah diproses PM lain atau status berubah');
        }
        const row = await tx.visitRequest.findUniqueOrThrow({ where: { id } });
        await tx.visitApprovalLog.create({
          data: {
            visitRequestId: id,
            actorId: pmUserId,
            action: 'VISIT_GATE_APPROVED',
            fromStatus: 'PM_REVIEW_VISIT',
            toStatus: 'APPROVED_PENDING_DATA',
            notes: dto.notes ?? null,
          },
        });
        return row;
      });

      this.gateway.emitToRoom(`user:${vr.requestedBy}`, 'visitRequest:visitGateApproved', {
        id,
        status: updatedRows.status,
      });

      await this.notifications.createForUser(vr.requestedBy, {
        title: 'Jadwal kunjungan disetujui',
        message: `PM menyetujui jadwal untuk ${siteLabel}. Silakan isi data survey lapangan lalu kirim untuk review PM.`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });

      return updatedRows;
    }

    const updated = await this.prisma.visitRequest.update({
      where: { id },
      data: {
        status: 'DRAFT',
        rejectionReason: dto.rejectionReason,
        visitGateApprovedAt: null,
        visitGateApprovedBy: null,
      },
    });

    await this.logApproval(
      id,
      pmUserId,
      'VISIT_GATE_REJECTED',
      'PM_REVIEW_VISIT',
      'DRAFT',
      dto.rejectionReason,
    );

    this.gateway.emitToRoom(`user:${vr.requestedBy}`, 'visitRequest:visitGateRejected', {
      id,
      status: 'DRAFT',
      rejectionReason: dto.rejectionReason,
    });

    await this.notifications.createForUser(vr.requestedBy, {
      title: 'Jadwal perlu direvisi',
      message: `PM meminta revisi jadwal untuk ${siteLabel}. Alasan: ${dto.rejectionReason}. Silakan ubah tanggal/jam kunjungan lalu ajukan ulang.`,
      type: 'VISIT_REQUEST',
      link: `/visit-requests/${id}`,
      entityId: id,
    });

    return updated;
  }

  /**
   * DRAFT → PM_REVIEW_VISIT (clearing rejectionReason, incl. setelah PM tolak gate jadwal).
   * REJECTED without visit gate (data lama) → PM_REVIEW_VISIT (re-approve schedule).
   * REJECTED after visit gate → PM_REVIEW_SURVEY (survey resubmit; preserves visitGate*).
   */
  async submit(id: string, userId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.requestedBy !== userId) {
      throw new ForbiddenException('Hanya pemohon yang bisa submit');
    }

    const siteLabel = vr.cleanList?.rwCode ?? vr.ispCustomer ?? id;
    const pmRole = pmRoleFromFiberType(String(vr.fiberType));

    if (vr.status === 'DRAFT') {
      const updated = await this.prisma.visitRequest.update({
        where: { id },
        data: { status: 'PM_REVIEW_VISIT', rejectionReason: null },
      });
      await this.logApproval(id, userId, 'SUBMITTED', 'DRAFT', 'PM_REVIEW_VISIT', null);

      this.gateway.emitToRoom(`role:${pmRole}`, 'visitRequest:submitted', {
        id,
        rwCode: vr.cleanList?.rwCode,
        ispCustomer: vr.ispCustomer,
        requestedBy: userId,
        gate: 'visit',
      });
      this.gateway.emitToRoom(`role:${Role.PM_SENIOR}`, 'visitRequest:submitted', {
        id,
        rwCode: vr.cleanList?.rwCode,
        gate: 'visit',
      });

      await this.notifications.createForRole(pmRole, {
        title: 'Permintaan review jadwal kunjungan',
        message: `Surveyor mengajukan jadwal kunjungan untuk ${siteLabel}. Perlu approval jadwal.`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
      await this.notifications.createForRole(Role.PM_SENIOR, {
        title: 'Permintaan review jadwal kunjungan',
        message: `Surveyor mengajukan jadwal — ${siteLabel}`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });

      return updated;
    }

    if (vr.status === 'REJECTED') {
      const hadVisitGate = vr.visitGateApprovedAt != null;

      if (!hadVisitGate) {
        await this.prisma.cleanList.update({
          where: { id: vr.cleanListId },
          data: { status: 'IN_PROGRESS' },
        });
        const updated = await this.prisma.visitRequest.update({
          where: { id },
          data: {
            status: 'PM_REVIEW_VISIT',
            rejectionReason: null,
          },
        });
        await this.logApproval(id, userId, 'SUBMITTED', 'REJECTED', 'PM_REVIEW_VISIT', null);

        this.gateway.emitToRoom(`role:${pmRole}`, 'visitRequest:submitted', {
          id,
          rwCode: vr.cleanList?.rwCode,
          ispCustomer: vr.ispCustomer,
          requestedBy: userId,
          gate: 'visit',
        });
        this.gateway.emitToRoom(`role:${Role.PM_SENIOR}`, 'visitRequest:submitted', {
          id,
          gate: 'visit',
        });

        await this.notifications.createForRole(pmRole, {
          title: 'Permintaan review jadwal kunjungan',
          message: `Surveyor mengajukan ulang jadwal untuk ${siteLabel}.`,
          type: 'VISIT_REQUEST',
          link: `/visit-requests/${id}`,
          entityId: id,
        });
        await this.notifications.createForRole(Role.PM_SENIOR, {
          title: 'Permintaan review jadwal kunjungan',
          message: `Pengajuan ulang jadwal — ${siteLabel}`,
          type: 'VISIT_REQUEST',
          link: `/visit-requests/${id}`,
          entityId: id,
        });

        return updated;
      }

      await this.prisma.cleanList.update({
        where: { id: vr.cleanListId },
        data: { status: 'IN_PROGRESS' },
      });
      const updated = await this.prisma.visitRequest.update({
        where: { id },
        data: {
          status: 'PM_REVIEW_SURVEY',
          rejectionReason: null,
          pmReviewedAt: null,
          pmReviewedBy: null,
        },
      });
      await this.logApproval(id, userId, 'SUBMITTED', 'REJECTED', 'PM_REVIEW_SURVEY', null);

      this.gateway.emitToRoom(`role:${pmRole}`, 'visitRequest:submitted', {
        id,
        rwCode: vr.cleanList?.rwCode,
        gate: 'survey',
      });
      this.gateway.emitToRoom(`role:${Role.PM_SENIOR}`, 'visitRequest:submitted', {
        id,
        gate: 'survey',
      });

      await this.notifications.createForRole(pmRole, {
        title: 'Hasil survey perlu review PM',
        message: `Surveyor mengirim ulang hasil survey untuk ${siteLabel}.`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
      await this.notifications.createForRole(Role.PM_SENIOR, {
        title: 'Hasil survey perlu review',
        message: `${siteLabel} — menunggu review hasil survey.`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });

      return updated;
    }

    throw new ConflictException(`Status tidak valid untuk submit: ${vr.status}`);
  }

  /** Surveyor fills lapangan data → PM_REVIEW_SURVEY (or auto-reject if NOT_ALLOWED). */
  async submitSurveyData(id: string, dto: SubmitSurveyDataDtoType, userId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.requestedBy !== userId) {
      throw new ForbiddenException('Hanya pemohon yang bisa mengisi data survey');
    }
    if (vr.status !== 'APPROVED_PENDING_DATA') {
      throw new ConflictException(`Status tidak valid untuk mengirim data survey: ${vr.status}`);
    }

    if (dto.stakeholderResponse === 'PENDING') {
      throw new BadRequestException(
        'Respon stakeholder belum diisi. Isi respon stakeholder terlebih dahulu.',
      );
    }

    const siteLabel = vr.cleanList?.rwCode ?? vr.ispCustomer ?? id;

    if (dto.stakeholderResponse === 'NOT_ALLOWED') {
      const rejected = await this.prisma.visitRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          stakeholderResponse: 'NOT_ALLOWED',
          rtContact: dto.rtContact ?? null,
          rwContact: dto.rwContact ?? null,
          pengelolaContact: dto.pengelolaContact ?? null,
          areaCondition: dto.areaCondition ?? null,
          existingNetworkFound: dto.existingNetworkFound,
          existingOperator: dto.existingOperator ?? null,
          surveyNotes: dto.surveyNotes ?? null,
          evidencePhotos: dto.evidencePhotos ?? [],
          rejectionReason:
            'Ditolak oleh stakeholder (RT/RW/Pengelola). Survey tidak mendapat izin.',
          pmReviewedAt: new Date(),
          pmReviewedBy: userId,
        },
      });

      await this.logApproval(
        id,
        userId,
        'SUBMITTED',
        'APPROVED_PENDING_DATA',
        'REJECTED',
        'Auto-rejected: stakeholderResponse = NOT_ALLOWED',
      );

      await this.prisma.cleanList.update({
        where: { id: vr.cleanListId },
        data: { status: 'AVAILABLE' },
      });

      await this.notifications.createForUser(userId, {
        title: 'Visit Request ditolak otomatis',
        message: `Visit request untuk ${siteLabel} ditolak karena stakeholder tidak memberikan izin.`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });

      return rejected;
    }

    if (dto.stakeholderResponse !== 'ALLOWED' && dto.stakeholderResponse !== 'CONDITIONAL') {
      throw new BadRequestException(
        'Respon stakeholder tidak valid untuk mengirim data survey.',
      );
    }

    const updated = await this.prisma.visitRequest.update({
      where: { id },
      data: {
        status: 'PM_REVIEW_SURVEY',
        rtContact: dto.rtContact ?? null,
        rwContact: dto.rwContact ?? null,
        pengelolaContact: dto.pengelolaContact ?? null,
        areaCondition: dto.areaCondition ?? null,
        existingNetworkFound: dto.existingNetworkFound,
        existingOperator: dto.existingOperator ?? null,
        stakeholderResponse: dto.stakeholderResponse,
        surveyNotes: dto.surveyNotes ?? null,
        evidencePhotos: dto.evidencePhotos ?? [],
      },
    });

    await this.logApproval(
      id,
      userId,
      'SUBMITTED',
      'APPROVED_PENDING_DATA',
      'PM_REVIEW_SURVEY',
      null,
    );

    const pmRole = pmRoleFromFiberType(String(vr.fiberType));
    this.gateway.emitToRoom(`role:${pmRole}`, 'visitRequest:submitted', {
      id,
      rwCode: vr.cleanList?.rwCode,
      gate: 'survey',
    });
    this.gateway.emitToRoom(`role:${Role.PM_SENIOR}`, 'visitRequest:submitted', {
      id,
      gate: 'survey',
    });

    await this.notifications.createForRole(pmRole, {
      title: 'Hasil survey perlu review PM',
      message: `Surveyor mengirim hasil survey untuk ${siteLabel}.`,
      type: 'VISIT_REQUEST',
      link: `/visit-requests/${id}`,
      entityId: id,
    });
    await this.notifications.createForRole(Role.PM_SENIOR, {
      title: 'Hasil survey perlu review',
      message: `Permintaan kunjungan ${siteLabel} menunggu review hasil survey.`,
      type: 'VISIT_REQUEST',
      link: `/visit-requests/${id}`,
      entityId: id,
    });

    return updated;
  }

  /** PM review survey results only (PM_REVIEW_SURVEY → ADMIN_REVIEW | REJECTED). */
  async pmReview(id: string, dto: ReviewVisitRequestDtoType, pmUserId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.status !== 'PM_REVIEW_SURVEY') {
      throw new ConflictException(
        `Status tidak valid untuk review hasil survey PM. Gunakan endpoint review jadwal jika masih menunggu approval kunjungan. Status saat ini: ${vr.status}`,
      );
    }

    const newStatus: VisitRequestStatus =
      dto.action === 'APPROVE' ? 'ADMIN_REVIEW' : 'REJECTED';

    const rejectNotes = dto.action === 'REJECT' ? (dto.notes ?? '').trim() : '';
    const updated = await this.prisma.visitRequest.update({
      where: { id },
      data: {
        status: newStatus,
        pmReviewedAt: new Date(),
        pmReviewedBy: pmUserId,
        ...(dto.action === 'REJECT' && { rejectionReason: rejectNotes }),
      },
    });

    if (dto.action === 'REJECT') {
      await this.prisma.cleanList.update({
        where: { id: vr.cleanListId },
        data: { status: 'AVAILABLE' },
      });
    }

    const action: ApprovalAction =
      dto.action === 'APPROVE' ? 'PM_APPROVED' : 'PM_REJECTED';
    await this.logApproval(id, pmUserId, action, vr.status, newStatus, dto.notes ?? null);

    this.gateway.emitToRoom(`user:${vr.requestedBy}`, 'visitRequest:pmReviewed', {
      id,
      status: newStatus,
      reviewedBy: pmUserId,
      notes: dto.notes,
    });

    const siteLabel = vr.cleanList?.rwCode ?? vr.ispCustomer ?? id;
    if (dto.action === 'APPROVE') {
      await this.notifications.createForRole(Role.ADMIN, {
        title: 'Visit request perlu persetujuan final',
        message: `PM menyetujui hasil survey ${siteLabel} — perlu approval Admin.`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
    } else {
      await this.notifications.createForUser(vr.requestedBy, {
        title: 'Hasil survey ditolak PM',
        message: `Alasan: ${dto.notes ?? 'Lihat detail'}`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
    }

    return updated;
  }

  async pmSeniorReview(id: string, dto: ReviewVisitRequestDtoType, pmSeniorId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.status !== 'PM_SENIOR_REVIEW') {
      throw new ConflictException(`Status tidak valid untuk PM Senior review: ${vr.status}`);
    }

    const newStatus: VisitRequestStatus =
      dto.action === 'APPROVE' ? 'ADMIN_REVIEW' : 'REJECTED';

    const updated = await this.prisma.visitRequest.update({
      where: { id },
      data: {
        status: newStatus,
        pmSeniorApprovedAt: new Date(),
        pmSeniorApprovedBy: pmSeniorId,
        ...(dto.action === 'REJECT' && { rejectionReason: dto.notes }),
      },
    });

    const action: ApprovalAction =
      dto.action === 'APPROVE' ? 'PM_SENIOR_APPROVED' : 'PM_SENIOR_REJECTED';
    await this.logApproval(id, pmSeniorId, action, 'PM_SENIOR_REVIEW', newStatus, dto.notes ?? null);

    this.gateway.emitToRoom(`user:${vr.pmReviewedBy}`, 'visitRequest:pmSeniorReviewed', {
      id,
      status: newStatus,
      reviewedBy: pmSeniorId,
      notes: dto.notes,
    });

    return updated;
  }

  async adminApprove(
    id: string,
    dto: ReviewVisitRequestDtoType,
    adminId: string,
    baOpenService: Pick<BaOpenService, 'generateBaOpen'>,
  ) {
    const vr = await this.findOneOrFail(id);
    if (vr.status !== 'ADMIN_REVIEW' && vr.status !== 'PM_SENIOR_REVIEW') {
      throw new ConflictException(`Status tidak valid untuk admin approval: ${vr.status}`);
    }

    const newStatus: VisitRequestStatus =
      dto.action === 'APPROVE' ? (vr.existingNetworkFound ? 'EXISTING_FIBER' : 'APPROVED') : 'REJECTED';

    await this.prisma.visitRequest.update({
      where: { id },
      data: {
        status: newStatus,
        adminApprovedAt: new Date(),
        adminApprovedBy: adminId,
        ...(dto.action === 'REJECT' && { rejectionReason: dto.notes }),
      },
    });

    const action: ApprovalAction =
      dto.action === 'APPROVE' ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED';
    await this.logApproval(id, adminId, action, vr.status, newStatus, dto.notes ?? null);

    let baOpenGenerated = false;

    if (dto.action === 'APPROVE') {
      const baseDesc = vr.surveyNotes || 'Auto-generated from admin approval visit request';
      const description = vr.existingNetworkFound
        ? `${baseDesc} [Area memiliki fiber existing: ${(vr.existingOperator ?? '').trim() || 'tercatat'}]`
        : baseDesc;

      await baOpenService.generateBaOpen(
        {
          visitRequestId: id,
          tanggal: new Date().toISOString(),
          tempat: vr.cleanList?.rwCode ? `Area ${vr.cleanList.rwCode}` : 'Lokasi survey',
          topik: `BA Open ${vr.cleanList?.rwCode || 'Cluster'}`,
          description,
          existingFiber: !!vr.existingNetworkFound,
          existingOperator: vr.existingOperator ?? null,
        },
        adminId,
      );
      baOpenGenerated = true;

      if (vr.existingNetworkFound) {
        await this.prisma.cleanList.update({
          where: { id: vr.cleanListId },
          data: {
            hasExistingFiber: true,
            existingOperator: vr.existingOperator,
            existingMarkedAt: new Date(),
            status: 'COMPLETED',
          },
        });
        this.gateway.emitToAll('gis:markedExisting', {
          cleanListId: vr.cleanListId,
          rwCode: vr.cleanList?.rwCode,
          operatorName: vr.existingOperator,
        });
      } else {
        await this.prisma.cleanList.update({
          where: { id: vr.cleanListId },
          data: { status: 'COMPLETED' },
        });
      }
    } else {
      await this.prisma.cleanList.update({
        where: { id: vr.cleanListId },
        data: { status: 'AVAILABLE' },
      });
    }

    this.gateway.emitToRoom(`user:${vr.requestedBy}`, 'visitRequest:adminApproved', {
      id,
      status: newStatus,
      baOpenGenerated,
    });

    const siteLabel = vr.cleanList?.rwCode ?? vr.ispCustomer ?? id;
    if (dto.action === 'APPROVE') {
      const fiberNote = vr.existingNetworkFound ? ' Area memiliki fiber existing — BA Open dan pipeline tetap dibuat.' : '';
      await this.notifications.createForUser(vr.requestedBy, {
        title: 'Visit request disetujui',
        message: `Permintaan untuk ${siteLabel} telah disetujui Admin.${fiberNote}`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
      await this.notifications.createForRole(Role.PM_SENIOR, {
        title: 'Visit request disetujui Admin',
        message: `Cluster ${siteLabel} disetujui.${fiberNote}`,
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
    } else if (dto.action === 'REJECT') {
      await this.notifications.createForUser(vr.requestedBy, {
        title: 'Visit request ditolak Admin',
        message: dto.notes ?? 'Lihat detail',
        type: 'VISIT_REQUEST',
        link: `/visit-requests/${id}`,
        entityId: id,
      });
    }

    return this.findOneOrFail(id);
  }

  async findAll(
    filters: VisitRequestFilterDtoType,
    userId: string,
    userRole: string,
  ): Promise<PaginatedResponse<unknown>> {
    const { status, fiberType, ispCustomer, page, limit, search, dateFrom, dateTo, sortBy, sortOrder, requestedBy } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.VisitRequestWhereInput = {};
    if (status) {
      if (status.includes(',')) {
        const st = status.split(',').map((s) => s.trim()).filter(Boolean) as VisitRequestStatus[];
        where.status = { in: st };
      } else {
        where.status = status as VisitRequestStatus;
      }
    }
    if (ispCustomer?.trim()) where.ispCustomer = { equals: ispCustomer.trim(), mode: 'insensitive' };
    if (requestedBy) where.requestedBy = requestedBy;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const andParts: Prisma.VisitRequestWhereInput[] = [];

    if (search?.trim()) {
      const q = search.trim();
      andParts.push({
        OR: [
          { cleanList: { rwCode: { contains: q, mode: 'insensitive' } } },
          { cleanList: { kelurahan: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    if (userRole.startsWith('SURVEYOR')) {
      where.requestedBy = userId;
      if (fiberType) where.fiberType = fiberType;
    } else if (['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(userRole)) {
      const ft = fiberType ?? (userRole.replace('PM_', '') as FiberType);
      where.fiberType = ft;
    } else {
      if (fiberType) where.fiberType = fiberType;
    }

    if (andParts.length) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...andParts];
    }

    const orderField =
      sortBy && ['createdAt', 'updatedAt', 'visitDate'].includes(sortBy) ? sortBy : 'updatedAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.VisitRequestOrderByWithRelationInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.visitRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          cleanList: { select: { rwCode: true, kelurahan: true, homepasCount: true, ispCustomer: true } },
          requester: { select: { id: true, name: true, role: true } },
          assignedPm: { select: { id: true, name: true } },
          baOpen: { select: { id: true, documentNumber: true, status: true } },
          permitCluster: { select: { id: true, clusterCode: true, currentPhase: true, status: true } },
          _count: { select: { approvalLogs: true } },
        },
      }),
      this.prisma.visitRequest.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: string, userId: string, userRole: string) {
    const vr = await this.prisma.visitRequest.findUnique({
      where: { id },
      include: {
        cleanList: true,
        requester: { select: { id: true, name: true, email: true, role: true } },
        assignedPm: { select: { id: true, name: true } },
        baOpen: true,
        permitCluster: {
          select: {
            id: true,
            clusterCode: true,
            currentPhase: true,
            status: true,
            readyForConstructionAt: true,
          },
        },
        approvalLogs: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!vr) throw new NotFoundException('Visit request tidak ditemukan');

    if (userRole.startsWith('SURVEYOR') && vr.requestedBy !== userId) {
      throw new ForbiddenException('Akses ditolak');
    }

    return vr;
  }

  async patchBySurveyor(id: string, body: unknown, userId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.requestedBy !== userId) {
      throw new ForbiddenException('Hanya surveyor yang membuat request ini yang bisa mengedit');
    }

    const legacyVisitRejected = vr.status === 'REJECTED' && vr.visitGateApprovedAt == null;
    const surveyRejected = vr.status === 'REJECTED' && vr.visitGateApprovedAt != null;

    if (vr.status === 'DRAFT' || legacyVisitRejected) {
      const parsed = PatchVisitDraftDto.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException(parsed.error.issues);
      }
      const data = parsed.data;
      const patch: Prisma.VisitRequestUpdateInput = {};
      if (data.visitDate !== undefined) {
        patch.visitDate = new Date(data.visitDate);
      }
      if (data.surveyNotes !== undefined) {
        patch.surveyNotes = data.surveyNotes;
      }
      return this.prisma.visitRequest.update({
        where: { id },
        data: patch,
        include: { cleanList: true, requester: true },
      });
    }

    if (surveyRejected) {
      const parsed = PatchVisitRejectedSurveyDto.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException(parsed.error.issues);
      }
      const bodySurvey = parsed.data;
      const patch: Prisma.VisitRequestUpdateInput = {
        rejectionReason: null,
      };
      if (bodySurvey.rtContact !== undefined) patch.rtContact = bodySurvey.rtContact;
      if (bodySurvey.rwContact !== undefined) patch.rwContact = bodySurvey.rwContact;
      if (bodySurvey.pengelolaContact !== undefined) patch.pengelolaContact = bodySurvey.pengelolaContact;
      if (bodySurvey.areaCondition !== undefined) patch.areaCondition = bodySurvey.areaCondition;
      if (bodySurvey.existingNetworkFound !== undefined) {
        patch.existingNetworkFound = bodySurvey.existingNetworkFound;
      }
      if (bodySurvey.existingOperator !== undefined) patch.existingOperator = bodySurvey.existingOperator;
      if (bodySurvey.stakeholderResponse !== undefined) {
        patch.stakeholderResponse = bodySurvey.stakeholderResponse;
      }
      if (bodySurvey.surveyNotes !== undefined) patch.surveyNotes = bodySurvey.surveyNotes;
      if (bodySurvey.evidencePhotos !== undefined && Array.isArray(bodySurvey.evidencePhotos)) {
        patch.evidencePhotos = bodySurvey.evidencePhotos.filter(
          (u): u is string => typeof u === 'string' && u.length > 0,
        );
      }
      return this.prisma.visitRequest.update({
        where: { id },
        data: patch,
        include: { cleanList: true, requester: true },
      });
    }

    throw new ConflictException(`Visit request tidak dapat diedit pada status: ${vr.status}`);
  }

  async uploadEvidence(id: string, files: Express.Multer.File[], userId: string) {
    const vr = await this.findOneOrFail(id);
    if (vr.requestedBy !== userId) throw new ForbiddenException('Hanya pemohon yang bisa upload');

    const allowedStatus =
      vr.status === 'APPROVED_PENDING_DATA' ||
      (vr.status === 'REJECTED' && vr.visitGateApprovedAt != null);
    if (!allowedStatus) {
      throw new ConflictException(
        'Upload foto hanya diperbolehkan saat mengisi data survey setelah jadwal disetujui',
      );
    }

    const urls: string[] = [];
    for (const file of files) {
      const key = `evidence/${id}/${Date.now()}-${file.originalname}`;
      const url = await this.storage.uploadBuffer(key, file.buffer, file.mimetype);
      urls.push(url);
    }

    const updated = await this.prisma.visitRequest.update({
      where: { id },
      data: { evidencePhotos: { push: urls } },
    });

    return { evidencePhotos: updated.evidencePhotos };
  }

  async getApprovalLog(id: string) {
    return this.prisma.visitApprovalLog.findMany({
      where: { visitRequestId: id },
      include: { actor: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * VR legacy status EXISTING_FIBER tanpa BA Open (backward compat sebelum Issue #46).
   */
  async findLegacyExistingFiberWithoutBaOpen() {
    return this.prisma.visitRequest.findMany({
      where: {
        status: VisitRequestStatus.EXISTING_FIBER,
        baOpen: null,
      },
      include: {
        cleanList: {
          select: { id: true, rwCode: true, kelurahan: true, hasExistingFiber: true },
        },
        requester: { select: { id: true, name: true, email: true } },
      },
      orderBy: { adminApprovedAt: 'desc' },
    });
  }

  /**
   * Generate BA Open untuk VR legacy EXISTING_FIBER yang belum punya BaOpen.
   * `generateBaOpen` memakai koneksi Prisma sendiri; validasi state dilakukan dalam transaksi Serializable.
   */
  async regenerateBaOpenForLegacyVr(
    vrId: string,
    adminUserId: string,
    baOpenService: Pick<BaOpenService, 'generateBaOpen'>,
  ): Promise<{ baOpenId: string; visitRequestId: string; documentNumber: string }> {
    const vr = await runSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.visitRequest.findUnique({
        where: { id: vrId },
        include: { cleanList: true, baOpen: true },
      });
      if (!row) {
        throw new NotFoundException('Visit request tidak ditemukan');
      }
      if (row.status !== VisitRequestStatus.EXISTING_FIBER) {
        throw new BadRequestException(
          `Visit request harus berstatus EXISTING_FIBER (saat ini: ${row.status})`,
        );
      }
      if (row.baOpen) {
        throw new BadRequestException(
          `Sudah ada BA Open ${row.baOpen.documentNumber}. Regenerate tidak diperlukan.`,
        );
      }
      return row;
    });

    const baseDesc = vr.surveyNotes || 'Regenerasi BA Open untuk data VR legacy (fiber existing)';
    const description = `${baseDesc} [Regenerasi admin — fiber existing: ${(vr.existingOperator ?? '').trim() || 'tercatat'}]`;

    const baOpen = await baOpenService.generateBaOpen(
      {
        visitRequestId: vrId,
        tanggal: new Date().toISOString(),
        tempat: vr.cleanList?.rwCode ? `Area ${vr.cleanList.rwCode}` : 'Lokasi survey',
        topik: `BA Open ${vr.cleanList?.rwCode || 'Cluster'} (legacy)`,
        description,
        existingFiber: true,
        existingOperator: vr.existingOperator ?? null,
      },
      adminUserId,
    );

    await this.notifications.createForUser(adminUserId, {
      title: 'BA Open legacy berhasil dibuat',
      message: `BA Open ${baOpen.documentNumber} untuk visit request telah dibuat.`,
      type: 'VISIT_REQUEST',
      link: `/visit-requests/${vrId}`,
      entityId: vrId,
    });

    return { baOpenId: baOpen.id, visitRequestId: vrId, documentNumber: baOpen.documentNumber };
  }

  private async findOneOrFail(id: string) {
    const vr = await this.prisma.visitRequest.findUnique({
      where: { id },
      include: { cleanList: { select: { rwCode: true, ispCustomer: true } } },
    });
    if (!vr) throw new NotFoundException('Visit request tidak ditemukan');
    return vr;
  }

  private async logApproval(
    visitRequestId: string,
    actorId: string,
    action: ApprovalAction,
    fromStatus: string,
    toStatus: string,
    notes: string | null,
  ) {
    return this.prisma.visitApprovalLog.create({
      data: { visitRequestId, actorId, action, fromStatus, toStatus, notes },
    });
  }
}
