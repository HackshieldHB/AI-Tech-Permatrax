import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitRequestService } from './visit-request.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { FiberType, VisitRequestStatus } from '@prisma/client';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('VisitRequestService', () => {
  let service: VisitRequestService;
  const prisma = {
    cleanList: { findUnique: jest.fn(), update: jest.fn() },
    visitRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    visitApprovalLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const gateway = { emitToRoom: jest.fn(), emitToAll: jest.fn() };
  const storage = { uploadBuffer: jest.fn() };
  const notifications = { createForUser: jest.fn(), createForRole: jest.fn() };
  const baseCleanList = { id: 'cl1', status: 'AVAILABLE', ispCustomer: 'FiberStar', rwCode: 'RW01' };

  const baseVrDraft = {
    id: 'vr1',
    status: 'DRAFT',
    requestedBy: 'u1',
    fiberType: FiberType.FTTH,
    cleanListId: 'cl1',
    visitGateApprovedAt: null as Date | null,
    cleanList: { rwCode: 'RW01' },
    ispCustomer: 'FiberStar',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (runSerializableTransaction as jest.Mock).mockImplementation(async (client: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    );
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: NotificationsService, useValue: notifications },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VisitRequestService);
  });

  describe('create', () => {
    it('creates visit request with DRAFT status', async () => {
      prisma.cleanList.findUnique.mockResolvedValue(baseCleanList);
      prisma.visitRequest.findFirst.mockResolvedValue(null);
      prisma.visitRequest.create.mockResolvedValue({ id: 'vr1', status: 'DRAFT' });
      const result = await service.create(
        {
          cleanListId: 'cl1',
          fiberType: FiberType.FTTH,
          visitDate: new Date().toISOString(),
        },
        'u1',
      );
      expect(result.status).toBe('DRAFT');
    });

    it('updates cleanList status to IN_PROGRESS', async () => {
      prisma.cleanList.findUnique.mockResolvedValue(baseCleanList);
      prisma.visitRequest.findFirst.mockResolvedValue(null);
      prisma.visitRequest.create.mockResolvedValue({ id: 'vr1', status: 'DRAFT' });
      await service.create(
        {
          cleanListId: 'cl1',
          fiberType: FiberType.FTTH,
          visitDate: new Date().toISOString(),
        },
        'u1',
      );
      expect(prisma.cleanList.update).toHaveBeenCalledWith({
        where: { id: 'cl1' },
        data: { status: 'IN_PROGRESS' },
      });
    });

    it('throws ConflictException if active request already exists for this RW', async () => {
      prisma.cleanList.findUnique.mockResolvedValue(baseCleanList);
      prisma.visitRequest.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ cleanListId: 'cl1', fiberType: FiberType.FTTH, visitDate: new Date().toISOString() }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException if cleanList not found', async () => {
      prisma.cleanList.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ cleanListId: 'cl1', fiberType: FiberType.FTTH, visitDate: new Date().toISOString() }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException if cleanList status != AVAILABLE', async () => {
      prisma.cleanList.findUnique.mockResolvedValue({ ...baseCleanList, status: 'COMPLETED' });
      await expect(
        service.create({ cleanListId: 'cl1', fiberType: FiberType.FTTH, visitDate: new Date().toISOString() }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('submit', () => {
    it('changes status from DRAFT to PM_REVIEW_VISIT', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue(baseVrDraft);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'PM_REVIEW_VISIT' });
      const result = await service.submit('vr1', 'u1');
      expect(result.status).toBe('PM_REVIEW_VISIT');
    });

    it('clears rejectionReason when resubmitting from DRAFT after visit-gate reject', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        ...baseVrDraft,
        status: 'DRAFT',
        rejectionReason: 'Jadwal bentrok',
      });
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'PM_REVIEW_VISIT' });
      await service.submit('vr1', 'u1');
      expect(prisma.visitRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr1' },
        data: { status: 'PM_REVIEW_VISIT', rejectionReason: null },
      });
    });

    it('throws ForbiddenException if not the requester', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, requestedBy: 'u2' });
      await expect(service.submit('vr1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ConflictException if status is not DRAFT or REJECTED', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'ADMIN_REVIEW' });
      await expect(service.submit('vr1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates ApprovalLog entry with action SUBMITTED', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue(baseVrDraft);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'PM_REVIEW_VISIT' });
      await service.submit('vr1', 'u1');
      expect(prisma.visitApprovalLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'SUBMITTED' }) }),
      );
    });

    it('emits Socket.IO visitRequest:submitted to PM role room', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue(baseVrDraft);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'PM_REVIEW_VISIT' });
      await service.submit('vr1', 'u1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith(
        'role:PM_FTTH',
        'visitRequest:submitted',
        expect.any(Object),
      );
    });

    it('REJECTED without visit gate: sets clean list IN_PROGRESS and goes to PM_REVIEW_VISIT', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'REJECTED' });
      prisma.cleanList.update.mockResolvedValue({});
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'PM_REVIEW_VISIT' });
      const result = await service.submit('vr1', 'u1');
      expect(prisma.cleanList.update).toHaveBeenCalledWith({
        where: { id: 'cl1' },
        data: { status: 'IN_PROGRESS' },
      });
      expect(result.status).toBe('PM_REVIEW_VISIT');
    });

    it('REJECTED after visit gate: resubmits to PM_REVIEW_SURVEY without clearing visitGate', async () => {
      const approvedAt = new Date();
      prisma.visitRequest.findUnique.mockResolvedValue({
        ...baseVrDraft,
        status: 'REJECTED',
        visitGateApprovedAt: approvedAt,
        visitGateApprovedBy: 'pm1',
      });
      prisma.cleanList.update.mockResolvedValue({});
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'PM_REVIEW_SURVEY' });
      const result = await service.submit('vr1', 'u1');
      expect(result.status).toBe('PM_REVIEW_SURVEY');
      expect(prisma.visitRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PM_REVIEW_SURVEY',
            pmReviewedAt: null,
            pmReviewedBy: null,
          }),
        }),
      );
    });
  });

  describe('pmVisitReview', () => {
    it('APPROVE: moves to APPROVED_PENDING_DATA and sets visit gate audit', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'PM_REVIEW_VISIT' });
      prisma.visitRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.visitRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'vr1',
        status: 'APPROVED_PENDING_DATA',
      });
      prisma.visitApprovalLog.create.mockResolvedValue({});
      const result = await service.pmVisitReview(
        'vr1',
        { action: 'APPROVE', notes: 'ok' },
        'pm1',
      );
      expect(result.status).toBe('APPROVED_PENDING_DATA');
      expect(notifications.createForUser).toHaveBeenCalled();
    });

    it('REJECT: DRAFT, keeps clean list lock, logs VISIT_GATE_REJECTED → DRAFT', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'PM_REVIEW_VISIT' });
      prisma.visitRequest.update.mockResolvedValue({
        id: 'vr1',
        status: 'DRAFT',
        rejectionReason: 'Jadwal bentrok',
      });
      await service.pmVisitReview('vr1', { action: 'REJECT', rejectionReason: 'Jadwal bentrok' }, 'pm1');
      expect(prisma.cleanList.update).not.toHaveBeenCalled();
      expect(prisma.visitRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr1' },
        data: expect.objectContaining({
          status: 'DRAFT',
          rejectionReason: 'Jadwal bentrok',
          visitGateApprovedAt: null,
          visitGateApprovedBy: null,
        }),
      });
      expect(prisma.visitApprovalLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'VISIT_GATE_REJECTED',
            fromStatus: 'PM_REVIEW_VISIT',
            toStatus: 'DRAFT',
          }),
        }),
      );
      expect(gateway.emitToRoom).toHaveBeenCalledWith(
        'user:u1',
        'visitRequest:visitGateRejected',
        expect.objectContaining({ id: 'vr1', status: 'DRAFT' }),
      );
    });
  });

  describe('patchBySurveyor', () => {
    it('DRAFT: allows visitDate patch', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue(baseVrDraft);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'DRAFT' });
      const iso = new Date().toISOString();
      await service.patchBySurveyor('vr1', { visitDate: iso }, 'u1');
      expect(prisma.visitRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ visitDate: new Date(iso) }),
        }),
      );
    });

    it('DRAFT: rejects body with lapangan-only keys (strict DTO)', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        ...baseVrDraft,
        rejectionReason: 'Ubah jadwal',
      });
      await expect(
        service.patchBySurveyor(
          'vr1',
          { visitDate: new Date().toISOString(), stakeholderResponse: 'ALLOWED' },
          'u1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.visitRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('submitSurveyData', () => {
    it('PENDING stakeholder: BadRequest', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'APPROVED_PENDING_DATA' });
      await expect(
        service.submitSurveyData(
          'vr1',
          { stakeholderResponse: 'PENDING', existingNetworkFound: false, evidencePhotos: [] },
          'u1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('pmReview', () => {
    it('APPROVE: changes status from PM_REVIEW_SURVEY to ADMIN_REVIEW', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'PM_REVIEW_SURVEY' });
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'ADMIN_REVIEW' });
      const result = await service.pmReview('vr1', { action: 'APPROVE' }, 'pm1');
      expect(result.status).toBe('ADMIN_REVIEW');
    });

    it('REJECT: changes status to REJECTED with reason', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'PM_REVIEW_SURVEY' });
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'REJECTED', rejectionReason: 'Nope' });
      prisma.cleanList.update.mockResolvedValue({});
      const result = await service.pmReview('vr1', { action: 'REJECT', notes: 'Nope' }, 'pm1');
      expect(result.status).toBe('REJECTED');
    });

    it('creates ApprovalLog entry', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'PM_REVIEW_SURVEY' });
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'ADMIN_REVIEW' });
      await service.pmReview('vr1', { action: 'APPROVE' }, 'pm1');
      expect(prisma.visitApprovalLog.create).toHaveBeenCalled();
    });

    it('Conflict when still PM_REVIEW_VISIT', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ ...baseVrDraft, status: 'PM_REVIEW_VISIT' });
      await expect(service.pmReview('vr1', { action: 'APPROVE' }, 'pm1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('adminApprove', () => {
    it('APPROVE with existingNetworkFound=false: generates BA Open', async () => {
      const baOpenService = { generateBaOpen: jest.fn().mockResolvedValue({ id: 'ba1' }) };
      const vrBefore = {
        id: 'vr1',
        status: 'ADMIN_REVIEW',
        cleanListId: 'cl1',
        existingNetworkFound: false,
        requestedBy: 'u1',
        cleanList: { rwCode: 'RW01', ispCustomer: 'FiberStar' },
        surveyNotes: null,
        existingOperator: null,
        ispCustomer: 'FiberStar',
      };
      const vrAfter = { ...vrBefore, status: 'APPROVED' };
      prisma.visitRequest.findUnique.mockResolvedValueOnce(vrBefore).mockResolvedValue(vrAfter);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'APPROVED' });
      prisma.cleanList.update.mockResolvedValue({});
      const result = await service.adminApprove('vr1', { action: 'APPROVE' }, 'admin1', baOpenService);
      expect(result.status).toBe('APPROVED');
      expect(baOpenService.generateBaOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          visitRequestId: 'vr1',
          existingFiber: false,
        }),
        'admin1',
      );
    });

    it('APPROVE with existingNetworkFound=true: generates BA Open + existingFiber + CleanList COMPLETED', async () => {
      const baOpenService = { generateBaOpen: jest.fn().mockResolvedValue({ id: 'ba1' }) };
      const vrBefore = {
        id: 'vr1',
        status: 'ADMIN_REVIEW',
        cleanListId: 'cl1',
        existingNetworkFound: true,
        existingOperator: 'OldISP',
        requestedBy: 'u1',
        cleanList: { rwCode: 'RW01', ispCustomer: 'FiberStar' },
        surveyNotes: 'Cat survey',
        ispCustomer: 'FiberStar',
      };
      const vrAfter = { ...vrBefore, status: 'EXISTING_FIBER' };
      prisma.visitRequest.findUnique.mockResolvedValueOnce(vrBefore).mockResolvedValue(vrAfter);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'EXISTING_FIBER' });
      prisma.cleanList.update.mockResolvedValue({});
      const result = await service.adminApprove('vr1', { action: 'APPROVE' }, 'admin1', baOpenService);
      expect(result.status).toBe('EXISTING_FIBER');
      expect(baOpenService.generateBaOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          visitRequestId: 'vr1',
          existingFiber: true,
          existingOperator: 'OldISP',
        }),
        'admin1',
      );
      expect(prisma.cleanList.update).toHaveBeenCalledWith({
        where: { id: 'cl1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          hasExistingFiber: true,
        }),
      });
      expect(gateway.emitToAll).toHaveBeenCalledWith(
        'gis:markedExisting',
        expect.objectContaining({ cleanListId: 'cl1' }),
      );
    });

    it('REJECT: status = REJECTED', async () => {
      const baOpenService = { generateBaOpen: jest.fn() };
      const vrBefore = {
        id: 'vr1',
        status: 'ADMIN_REVIEW',
        cleanListId: 'cl1',
        existingNetworkFound: false,
        requestedBy: 'u1',
        cleanList: { rwCode: 'RW01', ispCustomer: 'FiberStar' },
        ispCustomer: 'FiberStar',
      };
      const vrAfter = { ...vrBefore, status: 'REJECTED' };
      prisma.visitRequest.findUnique.mockResolvedValueOnce(vrBefore).mockResolvedValue(vrAfter);
      prisma.visitRequest.update.mockResolvedValue({ id: 'vr1', status: 'REJECTED' });
      prisma.cleanList.update.mockResolvedValue({});
      const result = await service.adminApprove('vr1', { action: 'REJECT', notes: 'x' }, 'admin1', baOpenService);
      expect(result.status).toBe('REJECTED');
      expect(baOpenService.generateBaOpen).not.toHaveBeenCalled();
    });
  });

  describe('findLegacyExistingFiberWithoutBaOpen', () => {
    it('memanggil findMany dengan filter EXISTING_FIBER dan tanpa BaOpen', async () => {
      prisma.visitRequest.findMany.mockResolvedValue([]);
      await service.findLegacyExistingFiberWithoutBaOpen();
      expect(prisma.visitRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: VisitRequestStatus.EXISTING_FIBER,
            baOpen: null,
          },
          orderBy: { adminApprovedAt: 'desc' },
        }),
      );
    });
  });

  describe('regenerateBaOpenForLegacyVr', () => {
    it('generateBaOpen + notifikasi untuk VR legacy valid', async () => {
      const baOpenService = { generateBaOpen: jest.fn().mockResolvedValue({ id: 'ba-new', documentNumber: 'BA-OPEN-2026-0001' }) };
      prisma.visitRequest.findUnique.mockResolvedValue({
        id: 'vr-leg',
        status: VisitRequestStatus.EXISTING_FIBER,
        baOpen: null,
        surveyNotes: null,
        existingOperator: 'ISP Lama',
        cleanList: { rwCode: 'RW-99', kelurahan: 'Kel' },
      });
      const out = await service.regenerateBaOpenForLegacyVr('vr-leg', 'admin1', baOpenService);
      expect(baOpenService.generateBaOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          visitRequestId: 'vr-leg',
          existingFiber: true,
          existingOperator: 'ISP Lama',
        }),
        'admin1',
      );
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'admin1',
        expect.objectContaining({ type: 'VISIT_REQUEST', title: expect.stringContaining('BA Open legacy') }),
      );
      expect(out.baOpenId).toBe('ba-new');
      expect(out.documentNumber).toBe('BA-OPEN-2026-0001');
    });

    it('menolak jika status bukan EXISTING_FIBER', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        id: 'vr-x',
        status: VisitRequestStatus.APPROVED,
        baOpen: null,
        cleanList: { rwCode: 'RW1' },
      });
      await expect(
        service.regenerateBaOpenForLegacyVr('vr-x', 'admin1', { generateBaOpen: jest.fn() }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('menolak jika sudah ada BaOpen', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        id: 'vr-y',
        status: VisitRequestStatus.EXISTING_FIBER,
        baOpen: { documentNumber: 'BA-OLD' },
        cleanList: { rwCode: 'RW1' },
      });
      await expect(
        service.regenerateBaOpenForLegacyVr('vr-y', 'admin1', { generateBaOpen: jest.fn() }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
