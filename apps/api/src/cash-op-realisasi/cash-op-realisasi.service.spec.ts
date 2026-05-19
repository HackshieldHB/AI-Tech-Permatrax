import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { CashOpRealisasiService } from './cash-op-realisasi.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService, CashOpPartialRefundType } from '../budget-ledger/budget-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('CashOpRealisasiService', () => {
  let service: CashOpRealisasiService;

  let cashOpRow: Record<string, unknown>;
  let items: Array<Record<string, unknown>>;
  let steps: Array<Record<string, unknown>>;

  const budgetLedger = { partialRefundForCashOp: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notifyUsersByRole: jest.fn().mockResolvedValue(1),
    createForUser: jest.fn().mockResolvedValue({}),
    createForRole: jest.fn().mockResolvedValue([{}]),
    emitRealtime: jest.fn(),
  };

  const prisma = {
    cashOperationRequest: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...cashOpRow })),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(cashOpRow, data);
        return { ...cashOpRow };
      }),
    },
    cashOpRealisasiItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => {
        items = data.map((d, i) => ({ ...d, id: `i-${i}` }));
        return { count: data.length };
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const idx = items.findIndex((it) => it.id === where.id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...data };
          return items[idx];
        }
        return null;
      }),
    },
    cashOpRealisasiStep: {
      findFirst: jest.fn().mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return (
          steps.find((s) => {
            if (where.status && s.status !== where.status) return false;
            if (where.approverRole && s.approverRole !== where.approverRole) return false;
            if (where.cashOpRequestId && s.cashOpRequestId !== where.cashOpRequestId) return false;
            return true;
          }) ?? null
        );
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = steps.findIndex((s) => s.id === where.id);
        if (idx !== -1) Object.assign(steps[idx], data);
        return steps[idx];
      }),
    },
    $transaction: jest.fn((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      if (typeof arg === 'function') return (arg as (t: unknown) => Promise<unknown>)(buildTx());
      return Promise.resolve();
    }),
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Pengaju' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', name: 'Pengaju', role: Role.PM_FTTH }),
    },
  };

  const buildTx = () => ({
    cashOperationRequest: {
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...cashOpRow })),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(cashOpRow, data);
        return { ...cashOpRow };
      }),
    },
    cashOpRealisasiItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => {
        items = data.map((d, i) => ({ ...d, id: `i-${i}` }));
        return { count: data.length };
      }),
      findMany: jest.fn().mockImplementation(async () => items),
      count: jest.fn().mockImplementation(async () => items.length),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const idx = items.findIndex((it) => it.id === where.id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...data };
          return items[idx];
        }
        return null;
      }),
    },
    cashOpRealisasiStep: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => {
        steps = data.map((d, i) => ({ ...d, id: `st-${i}` }));
        return { count: data.length };
      }),
      findFirst: jest.fn().mockImplementation(async (args?: { where?: Record<string, unknown>; orderBy?: { stepOrder: string } }) => {
        const where = args?.where ?? {};
        let candidates = steps.filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.approverRole && s.approverRole !== where.approverRole) return false;
          if (where.cashOpRequestId && s.cashOpRequestId !== where.cashOpRequestId) return false;
          return true;
        });
        if (args?.orderBy?.stepOrder === 'asc') {
          candidates = [...candidates].sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
        }
        return candidates[0] ?? null;
      }),
      findFirstOrThrow: jest.fn().mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        const s = steps.find((step) => {
          if (where.status && step.status !== where.status) return false;
          if (where.approverRole && step.approverRole !== where.approverRole) return false;
          if (where.cashOpRequestId && step.cashOpRequestId !== where.cashOpRequestId) return false;
          return true;
        });
        if (!s) throw new Error('Not found');
        return s;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
         const idx = steps.findIndex(s => s.id === where.id);
         if (idx !== -1) Object.assign(steps[idx], data);
         return steps[idx];
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockImplementation(async () => steps),
    },
    user: prisma.user,
  });

  const draftDto = {
    items: [
      {
        itemNumber: 1,
        description: 'Angkutan',
        paymentDate: '2026-01-15T00:00:00.000Z',
        amount: 100_000,
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    items = [];
    steps = [];
    cashOpRow = {
      id: 'co1',
      requestNumber: 'CA-1',
      type: 'CASH_ADVANCE',
      status: 'APPROVED',
      requestedBy: 'u1',
      periodeTo: new Date('2020-01-10T00:00:00.000Z'),
      approvedAt: new Date('2026-01-01'),
      realisasiStatus: null,
      realisasiTotal: null,
      finalApprovedAmount: new Prisma.Decimal(1_000_000),
      realisasiCurrentStepRole: null,
      realisasiRejectionReason: null,
      realisasiSubmittedAt: null,
    };

    (runSerializableTransaction as jest.Mock).mockImplementation(
      async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx()),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashOpRealisasiService,
        { provide: PrismaService, useValue: prisma },
        { provide: BudgetLedgerService, useValue: budgetLedger },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(CashOpRealisasiService);
  });

  describe('saveDraft', () => {
    it('happy path → DRAFT + REALISASI_IN_PROGRESS', async () => {
      const out = await service.saveDraft('co1', 'u1', draftDto);
      expect(out.realisasiStatus).toBe('DRAFT');
      expect(out.status).toBe('REALISASI_IN_PROGRESS');
      expect(items).toHaveLength(1);
      expect(new Prisma.Decimal(out.realisasiTotal!).toNumber()).toBe(100_000);
    });

    it('400 bila belum disetujui', async () => {
      cashOpRow.approvedAt = null;
      await expect(service.saveDraft('co1', 'u1', draftDto)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('submit', () => {
    it('PM_FTTH submitter → PENDING_OPS_REVIEW + chain OPS→FIN→GM', async () => {
      await service.saveDraft('co1', 'u1', draftDto);
      const out = await service.submit('co1', 'u1');
      expect(out.realisasiStatus).toBe('PENDING_OPS_REVIEW');
      expect(out.realisasiCurrentStepRole).toBe(Role.OPERATIONAL_MANAGER);
      expect(steps).toHaveLength(3);
      expect(steps[0].approverRole).toBe(Role.OPERATIONAL_MANAGER);
      expect(steps[1].approverRole).toBe(Role.FINANCE);
      expect(steps[2].approverRole).toBe(Role.GENERAL_MANAGER);
    });

    it('Marketing submitter → PENDING_MARKETING_HEAD_REVIEW (no 3-photo rule)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ role: Role.MARKETING, id: 'u1' });
      await service.saveDraft('co1', 'u1', draftDto);
      const out = await service.submit('co1', 'u1');
      expect(out.realisasiStatus).toBe('PENDING_MARKETING_HEAD_REVIEW');
      expect(out.realisasiCurrentStepRole).toBe(Role.MARKETING_HEAD);
    });
  });

  describe('approve', () => {
    it('Ops Manager setuju setelah submit → PENDING_FINANCE_REVIEW', async () => {
      await service.saveDraft('co1', 'u1', draftDto);
      await service.submit('co1', 'u1');

      const out = await service.approve('co1', 'ops1', Role.OPERATIONAL_MANAGER, 'ok');
      expect(out.data.realisasiStatus).toBe('PENDING_FINANCE_REVIEW');
      expect(cashOpRow.realisasiCurrentStepRole).toBe(Role.FINANCE);
      expect(steps[0].status).toBe('APPROVED');
    });

    it('Finance setuju → DONE + partial refund bila ada selisih', async () => {
      await service.saveDraft('co1', 'u1', draftDto);
      await service.submit('co1', 'u1');
      await service.approve('co1', 'ops1', Role.OPERATIONAL_MANAGER);
      await service.approve('co1', 'fin1', Role.FINANCE, 'ok');

      cashOpRow.status = 'REALISASI_PENDING_GM';
      cashOpRow.realisasiCurrentStepRole = Role.GENERAL_MANAGER;

      cashOpRow.finalApprovedAmount = new Prisma.Decimal(100_000);
      cashOpRow.realisasiTotal = new Prisma.Decimal(80_000);

      const out = await service.approve('co1', 'gm1', Role.GENERAL_MANAGER, 'cek ok');
      expect(out.data.realisasiStatus).toBe('DONE');
      expect(budgetLedger.partialRefundForCashOp).toHaveBeenCalledWith(
        'co1',
        new Prisma.Decimal(20_000),
        expect.any(String),
        'gm1',
        CashOpPartialRefundType.REALISASI_VARIANCE,
        expect.anything()
      );
      const gmStep = steps.find((s) => (s as { approverRole?: string }).approverRole === Role.GENERAL_MANAGER);
      expect(gmStep?.status).toBe('APPROVED');
    });
  });

  describe('approveByOps', () => {
    it('status → REALISASI_PENDING_FINANCE when approved', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await service.approveByOps('co1', 'ops1', 'ok');
      expect(cashOpRow.status).toBe('REALISASI_PENDING_FINANCE');
      expect(cashOpRow.realisasiStatus).toBe('PENDING_FINANCE_REVIEW');
    });

    it('notifies FINANCE role', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await service.approveByOps('co1', 'ops1');
      expect(notifications.createForRole).toHaveBeenCalledWith(
        Role.FINANCE,
        expect.objectContaining({ title: expect.stringContaining('Siap Diperiksa') })
      );
    });

    it('throws 403 if actor not OPERATIONAL_MANAGER', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await expect(service.approveByOps('co1', 'fin1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 400 if status not PENDING_OPS or IN_PROGRESS', async () => {
      cashOpRow.status = 'REALISASI_DONE';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await expect(service.approveByOps('co1', 'ops1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rejectByOps', () => {
    it('status → REALISASI_REJECTED_BY_OPS', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await service.rejectByOps('co1', 'ops1', 'data tidak lengkap');
      expect(cashOpRow.status).toBe('REALISASI_REJECTED_BY_OPS');
      expect(cashOpRow.realisasiStatus).toBe('REJECTED');
    });

    it('stores rejection reason, actorId, timestamp', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await service.rejectByOps('co1', 'ops1', 'bukti kurang jelas');
      expect(cashOpRow.realisasiRejectedReason).toBe('bukti kurang jelas');
      expect(cashOpRow.realisasiRejectedById).toBe('ops1');
      expect(cashOpRow.realisasiRejectedAt).toBeInstanceOf(Date);
    });

    it('notifies requestor', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await service.rejectByOps('co1', 'ops1', 'ditolak');
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ title: expect.stringContaining('Ditolak') })
      );
    });

    it('throws 400 if reason is empty', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await expect(service.rejectByOps('co1', 'ops1', '')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('editAndApproveByFinance', () => {
    it('throws 400 if nomorRekeningFinance empty', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await expect(
        service.editAndApproveByFinance('co1', 'fin1', { nomorRekeningFinance: '', financeSignatureUrl: '' })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates finalAmount on items when provided', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      items = [{ id: 'it1', cashOpRequestId: 'co1', itemNumber: 1, description: 'Test', amount: new Prisma.Decimal(50000), finalAmount: null, photoUrl: null }];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: '123456',
        financeSignatureUrl: 'https://example.com/ttd.png',
        items: [{ itemId: 'it1', finalAmount: 45000 }],
      });
      expect(items[0].finalAmount).toEqual(new Prisma.Decimal(45000));
    });

    it('stores nomorRekeningFinance', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', { nomorRekeningFinance: 'BCA-123', financeSignatureUrl: 'https://example.com/ttd.png' });
      expect(cashOpRow.realisasiNomorRekeningFinance).toBe('BCA-123');
    });

    it('status → REALISASI_PENDING_GM when GM step is next in chain', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      steps = [
        { id: 'st-gm', cashOpRequestId: 'co1', stepOrder: 1, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
      ];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', { nomorRekeningFinance: 'BCA-123', financeSignatureUrl: 'https://example.com/ttd.png' });
      expect(cashOpRow.status).toBe('REALISASI_PENDING_GM');
      expect(cashOpRow.realisasiStatus).toBe('PENDING_GM_REVIEW');
    });

    it('notifies GENERAL_MANAGER (next in chain)', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      cashOpRow.requestedBy = 'u1';
      steps = [
        { id: 'st-gm', cashOpRequestId: 'co1', stepOrder: 1, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
      ];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', { nomorRekeningFinance: 'BCA-123', financeSignatureUrl: 'https://example.com/ttd.png' });
      expect(notifications.createForRole).toHaveBeenCalledWith(
        Role.GENERAL_MANAGER,
        expect.objectContaining({ title: expect.stringContaining('Siap Diperiksa') })
      );
    });

    it('throws 403 if actor not FINANCE', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await expect(
        service.editAndApproveByFinance('co1', 'ops1', { nomorRekeningFinance: '123', financeSignatureUrl: 'https://example.com/ttd.png' })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('rejectByFinance', () => {
    it('status → REALISASI_REJECTED_BY_FINANCE', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.rejectByFinance('co1', 'fin1', 'dokumen tidak lengkap');
      expect(cashOpRow.status).toBe('REALISASI_REJECTED_BY_FINANCE');
      expect(cashOpRow.realisasiStatus).toBe('REJECTED');
    });

    it('notifies requestor', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.rejectByFinance('co1', 'fin1', 'ditolak');
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ title: expect.stringContaining('Ditolak') })
      );
    });

    it('throws 400 if reason empty', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await expect(service.rejectByFinance('co1', 'fin1', '')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resubmitRealisasi', () => {
    it('status → REALISASI_PENDING_OPS for PM requester (new chain)', async () => {
      cashOpRow.status = 'REALISASI_REJECTED_BY_OPS';
      cashOpRow.requestedBy = 'u1';
      await service.resubmitRealisasi('co1', 'u1', draftDto);
      expect(cashOpRow.status).toBe('REALISASI_PENDING_OPS');
      expect(cashOpRow.realisasiStatus).toBe('PENDING_OPS_REVIEW');
    });

    it('clears rejection fields', async () => {
      cashOpRow.status = 'REALISASI_REJECTED_BY_OPS';
      cashOpRow.requestedBy = 'u1';
      cashOpRow.realisasiRejectedAt = new Date();
      cashOpRow.realisasiRejectedById = 'ops1';
      cashOpRow.realisasiRejectedReason = 'ditolak';
      await service.resubmitRealisasi('co1', 'u1', draftDto);
      expect(cashOpRow.realisasiRejectedAt).toBeNull();
      expect(cashOpRow.realisasiRejectedById).toBeNull();
      expect(cashOpRow.realisasiRejectedReason).toBeNull();
    });

    it('notifies OPERATIONAL_MANAGER (first in new chain)', async () => {
      cashOpRow.status = 'REALISASI_REJECTED_BY_FINANCE';
      cashOpRow.requestedBy = 'u1';
      await service.resubmitRealisasi('co1', 'u1', draftDto);
      expect(notifications.createForRole).toHaveBeenCalledWith(
        Role.OPERATIONAL_MANAGER,
        expect.objectContaining({ title: expect.stringContaining('Diajukan Ulang') })
      );
    });

    it('throws 403 if actor is not original requestor', async () => {
      cashOpRow.status = 'REALISASI_REJECTED_BY_OPS';
      cashOpRow.requestedBy = 'u1';
      await expect(service.resubmitRealisasi('co1', 'other-user', draftDto)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 400 if status not REJECTED_BY_OPS or REJECTED_BY_FINANCE', async () => {
      cashOpRow.status = 'REALISASI_DONE';
      cashOpRow.requestedBy = 'u1';
      await expect(service.resubmitRealisasi('co1', 'u1', draftDto)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('buildRealisasiApprovalChain', () => {
    it('MARKETING → chain is [MARKETING_HEAD, FINANCE, GENERAL_MANAGER]', () => {
      const chain = (service as any).buildRealisasiApprovalChain('MARKETING');
      expect(chain).toEqual([Role.MARKETING_HEAD, Role.FINANCE, Role.GENERAL_MANAGER]);
    });

    it('MARKETING_HEAD → chain is [MARKETING_HEAD, FINANCE, GENERAL_MANAGER]', () => {
      const chain = (service as any).buildRealisasiApprovalChain('MARKETING_HEAD');
      expect(chain).toEqual([Role.MARKETING_HEAD, Role.FINANCE, Role.GENERAL_MANAGER]);
    });

    it('PM_FTTH → chain is [OPERATIONAL_MANAGER, FINANCE, GENERAL_MANAGER]', () => {
      const chain = (service as any).buildRealisasiApprovalChain('PM_FTTH');
      expect(chain).toEqual([Role.OPERATIONAL_MANAGER, Role.FINANCE, Role.GENERAL_MANAGER]);
    });

    it('ADMIN → chain is [OPERATIONAL_MANAGER, FINANCE, GENERAL_MANAGER]', () => {
      const chain = (service as any).buildRealisasiApprovalChain('ADMIN');
      expect(chain).toEqual([Role.OPERATIONAL_MANAGER, Role.FINANCE, Role.GENERAL_MANAGER]);
    });
  });

  describe('approveByPm', () => {
    it('transitions status to REALISASI_PENDING_OPS and notifies OPS', async () => {
      cashOpRow.status = 'REALISASI_PENDING_PM';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.PM_SENIOR, id: 'pm1' });

      await service.approveByPm('co1', 'pm1', 'Approved by PM');

      expect(cashOpRow.status).toBe('REALISASI_PENDING_OPS');
      expect(cashOpRow.realisasiStatus).toBe('PENDING_OPS_REVIEW');
      expect(notifications.createForRole).toHaveBeenCalledWith(
        Role.OPERATIONAL_MANAGER,
        expect.objectContaining({ title: expect.stringContaining('Realisasi Cash Advance Menunggu Approval') })
      );
    });

    it('throws 403 if actor is not PM_SENIOR', async () => {
      cashOpRow.status = 'REALISASI_PENDING_PM';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.ADMIN, id: 'admin1' });
      await expect(service.approveByPm('co1', 'admin1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 400 if status is not REALISASI_PENDING_PM', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.PM_SENIOR, id: 'pm1' });
      await expect(service.approveByPm('co1', 'pm1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rejectByPm', () => {
    it('transitions status to REALISASI_REJECTED_BY_PM and notifies requestor', async () => {
      cashOpRow.status = 'REALISASI_PENDING_PM';
      cashOpRow.requestedBy = 'u1';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.PM_SENIOR, id: 'pm1' });

      await service.rejectByPm('co1', 'pm1', 'Rejected by PM');

      expect(cashOpRow.status).toBe('REALISASI_REJECTED_BY_PM');
      expect(cashOpRow.realisasiStatus).toBe('REJECTED');
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ title: 'Realisasi Ditolak PM Senior' })
      );
    });

    it('throws 400 if reason is empty', async () => {
      cashOpRow.status = 'REALISASI_PENDING_PM';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.PM_SENIOR, id: 'pm1' });
      await expect(service.rejectByPm('co1', 'pm1', '')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('approveByGm', () => {
    it('status → REALISASI_DONE when GM is last step without signature', async () => {
      cashOpRow.status = 'REALISASI_PENDING_GM';
      steps = [];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });

      await service.approveByGm('co1', 'gm1', {});

      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.realisasiStatus).toBe('DONE');
      expect(cashOpRow.gmSignatureUrl).toBeUndefined();
    });

    it('status → REALISASI_DONE when GM is last step, stores signature when provided', async () => {
      cashOpRow.status = 'REALISASI_PENDING_GM';
      steps = [];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });

      await service.approveByGm('co1', 'gm1', { gmSignatureUrl: 'https://storage.com/gm-sig.png' });

      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.realisasiStatus).toBe('DONE');
      expect(cashOpRow.gmSignatureUrl).toBe('https://storage.com/gm-sig.png');
      expect(cashOpRow.realisasiCompletedAt).toBeInstanceOf(Date);
      expect(notifications.createForUser).toHaveBeenCalledWith(
        cashOpRow.requestedBy,
        expect.objectContaining({ title: expect.stringContaining('Selesai') })
      );
    });
  });

  describe('rejectByGm', () => {
    it('transitions status to REALISASI_REJECTED_BY_GM', async () => {
      cashOpRow.status = 'REALISASI_PENDING_GM';
      cashOpRow.requestedBy = 'u1';
      cashOpRow.realisasiCurrentStepRole = Role.GENERAL_MANAGER;
      steps = [
        {
          id: 'st-gm',
          cashOpRequestId: 'co1',
          stepOrder: 1,
          approverRole: Role.GENERAL_MANAGER,
          status: 'PENDING',
        },
      ];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });

      await service.rejectByGm('co1', 'gm1', 'Rejected by GM');

      expect(cashOpRow.status).toBe('REALISASI_REJECTED_BY_GM');
      expect(cashOpRow.realisasiStatus).toBe('REJECTED');
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ title: 'Realisasi Perlu Revisi' })
      );
    });
  });

  describe('editAndApproveByFinance optional signature', () => {
    it('approves without financeSignatureUrl when no next step', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      steps = [];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });

      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: '123456',
      });

      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.financeSignatureUrl).toBeUndefined();
    });

    it('stores financeSignatureUrl when provided', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      steps = [];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });

      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: '123456',
        financeSignatureUrl: 'https://storage.com/fin-sig.png',
      });

      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.financeSignatureUrl).toBe('https://storage.com/fin-sig.png');
    });
  });

  const marketingDraftDto = {
    items: [
      { itemNumber: 1, description: 'A', paymentDate: '2026-01-15T00:00:00.000Z', amount: 50_000, photoUrl: 'https://a.png' },
      { itemNumber: 2, description: 'B', paymentDate: '2026-01-16T00:00:00.000Z', amount: 30_000, photoUrl: 'https://b.png' },
      { itemNumber: 3, description: 'C', paymentDate: '2026-01-17T00:00:00.000Z', amount: 20_000, photoUrl: 'https://c.png' },
    ],
  };

  describe('Marketing flow: MARKETING_HEAD → FINANCE → GM → DONE', () => {
    beforeEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', name: 'Marketing User', role: Role.MARKETING });
    });

    afterEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', name: 'Pengaju', role: Role.PM_FTTH });
    });

    it('submit → PENDING_MARKETING_HEAD_REVIEW, chain length 3', async () => {
      cashOpRow.status = 'APPROVED';
      await service.saveDraft('co1', 'u1', marketingDraftDto);
      const out = await service.submit('co1', 'u1');
      expect(out.realisasiCurrentStepRole).toBe(Role.MARKETING_HEAD);
      expect(out.realisasiStatus).toBe('PENDING_MARKETING_HEAD_REVIEW');
      expect(steps).toHaveLength(3);
      expect(steps.map((s) => (s as { approverRole: string }).approverRole)).toEqual([
        Role.MARKETING_HEAD,
        Role.FINANCE,
        Role.GENERAL_MANAGER,
      ]);
    });

    it('Marketing Head approves → advances to PENDING_FINANCE_REVIEW', async () => {
      cashOpRow.status = 'REALISASI_PENDING_OPS'; // treated as PENDING_MARKETING_HEAD via generic approve
      cashOpRow.realisasiCurrentStepRole = Role.MARKETING_HEAD;
      steps = [
        { id: 'st-mh', cashOpRequestId: 'co1', stepOrder: 1, approverRole: Role.MARKETING_HEAD, status: 'PENDING' },
        { id: 'st-fin', cashOpRequestId: 'co1', stepOrder: 2, approverRole: Role.FINANCE, status: 'PENDING' },
        { id: 'st-gm', cashOpRequestId: 'co1', stepOrder: 3, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
      ];

      // Use the generic approve() with MARKETING_HEAD role
      cashOpRow.status = 'REALISASI_PENDING_MARKETING_HEAD' as any;
      const out = await service.approve('co1', 'mh1', Role.MARKETING_HEAD, 'ok');
      expect(out.data.realisasiStatus).toBe('PENDING_FINANCE_REVIEW');
      expect(cashOpRow.realisasiCurrentStepRole).toBe(Role.FINANCE);
      expect(notifications.notifyUsersByRole).toHaveBeenCalledWith(
        Role.FINANCE,
        expect.objectContaining({ title: expect.any(String) })
      );
    });

    it('reject by Marketing Head → REALISASI_REJECTED_BY_MARKETING_HEAD, notifies requestor', async () => {
      cashOpRow.status = 'REALISASI_PENDING_MARKETING_HEAD' as any;
      cashOpRow.realisasiCurrentStepRole = Role.MARKETING_HEAD;
      cashOpRow.requestedBy = 'u1';
      steps = [
        { id: 'st-mh', cashOpRequestId: 'co1', stepOrder: 1, approverRole: Role.MARKETING_HEAD, status: 'PENDING' },
      ];

      const out = await service.reject('co1', 'mh1', Role.MARKETING_HEAD, 'tidak sesuai prosedur');
      expect(out.data.status).toBe('REALISASI_REJECTED_BY_MARKETING_HEAD' as any);
      expect(out.data.realisasiStatus).toBe('REJECTED');
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ title: expect.stringContaining('Revisi') })
      );
    });

    it('full Marketing chain: MktHead → Finance(+rekening) → GM → DONE', async () => {
      cashOpRow.status = 'APPROVED';
      await service.saveDraft('co1', 'u1', marketingDraftDto);
      await service.submit('co1', 'u1');

      // Step 1: Marketing Head approves (via generic approve)
      cashOpRow.status = 'REALISASI_PENDING_MARKETING_HEAD' as any;
      cashOpRow.realisasiCurrentStepRole = Role.MARKETING_HEAD;
      await service.approve('co1', 'mh1', Role.MARKETING_HEAD);

      // Step 2: Finance approves with rekening (via editAndApproveByFinance)
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: 'BCA-999',
        financeSignatureUrl: 'https://example.com/fin-sig.png',
      });
      expect(cashOpRow.realisasiNomorRekeningFinance).toBe('BCA-999');
      expect(cashOpRow.status).toBe('REALISASI_PENDING_GM');

      // Step 3: GM approves last → DONE
      cashOpRow.realisasiCurrentStepRole = Role.GENERAL_MANAGER;
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });
      await service.approveByGm('co1', 'gm1', { gmSignatureUrl: 'https://example.com/gm-sig.png' });
      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.realisasiStatus).toBe('DONE');
      expect(cashOpRow.gmSignatureUrl).toBe('https://example.com/gm-sig.png');
    });
  });

  describe('Non-marketing flow: OPS → FINANCE → GM → DONE', () => {
    beforeEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', name: 'Pengaju', role: Role.PM_FTTH });
    });

    it('full chain: Ops approve → Finance approve(+rekening) → GM approve → DONE', async () => {
      cashOpRow.status = 'APPROVED';
      await service.saveDraft('co1', 'u1', draftDto);
      await service.submit('co1', 'u1');

      // Step 1: Ops approves
      cashOpRow.status = 'REALISASI_PENDING_OPS';
      cashOpRow.realisasiCurrentStepRole = Role.OPERATIONAL_MANAGER;
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.OPERATIONAL_MANAGER, id: 'ops1' });
      await service.approveByOps('co1', 'ops1', 'ok');
      expect(cashOpRow.status).toBe('REALISASI_PENDING_FINANCE');

      // Step 2: Finance approves with rekening
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: 'BNI-123',
        financeSignatureUrl: 'https://example.com/fin.png',
      });
      expect(cashOpRow.status).toBe('REALISASI_PENDING_GM');
      expect(cashOpRow.realisasiNomorRekeningFinance).toBe('BNI-123');

      // Step 3: GM approves last → DONE
      cashOpRow.realisasiCurrentStepRole = Role.GENERAL_MANAGER;
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });
      await service.approveByGm('co1', 'gm1', { gmSignatureUrl: 'https://example.com/gm.png' });
      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.realisasiStatus).toBe('DONE');
    });

    it('resubmit after rejection restarts from OPERATIONAL_MANAGER', async () => {
      cashOpRow.status = 'REALISASI_REJECTED_BY_OPS';
      cashOpRow.requestedBy = 'u1';
      // user is PM_FTTH (non-marketing), set by default mock
      await service.resubmitRealisasi('co1', 'u1', draftDto);
      expect(cashOpRow.status).toBe('REALISASI_PENDING_OPS');
      expect(cashOpRow.realisasiCurrentStepRole).toBe(Role.OPERATIONAL_MANAGER);
      expect(steps).toHaveLength(3); // OPS, FIN, GM
    });

    it('resubmit after marketing rejection restarts from MARKETING_HEAD', async () => {
      cashOpRow.status = 'REALISASI_REJECTED_BY_MARKETING_HEAD' as any;
      cashOpRow.requestedBy = 'u1';
      // Override user role to MARKETING
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ id: 'u1', role: Role.MARKETING });
      await service.resubmitRealisasi('co1', 'u1', draftDto);
      expect(cashOpRow.status).toBe('REALISASI_PENDING_MARKETING_HEAD' as any);
      expect(cashOpRow.realisasiCurrentStepRole).toBe(Role.MARKETING_HEAD);
      expect(steps).toHaveLength(3); // MKT_HEAD, FIN, GM
    });
  });

  describe('approveByGm (chain-aware)', () => {
    it('sets DONE when no next step (GM is last)', async () => {
      cashOpRow.status = 'REALISASI_PENDING_GM';
      cashOpRow.requestedBy = 'u1';
      steps = []; // no more PENDING steps after GM
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });
      await service.approveByGm('co1', 'gm1', { gmSignatureUrl: 'https://sig.png', notes: 'approved' });
      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.realisasiCompletedAt).toBeInstanceOf(Date);
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ title: expect.stringContaining('Selesai') })
      );
    });

    it('advances to Finance when Finance step is still PENDING (legacy edge case)', async () => {
      cashOpRow.status = 'REALISASI_PENDING_GM';
      steps = [
        { id: 'st-fin', cashOpRequestId: 'co1', stepOrder: 2, approverRole: Role.FINANCE, status: 'PENDING' },
      ];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });
      await service.approveByGm('co1', 'gm1', { gmSignatureUrl: 'https://sig.png' });
      expect(cashOpRow.status).toBe('REALISASI_PENDING_FINANCE');
      expect(cashOpRow.realisasiCurrentStepRole).toBe(Role.FINANCE);
    });

    it('throws 400 if status is not REALISASI_PENDING_GM', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.GENERAL_MANAGER, id: 'gm1' });
      await expect(service.approveByGm('co1', 'gm1', { gmSignatureUrl: 'https://sig.png' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('editAndApproveByFinance (chain-aware)', () => {
    it('advances to GM when GM step is next', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      steps = [
        { id: 'st-gm', cashOpRequestId: 'co1', stepOrder: 1, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
      ];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: 'BCA-456',
        financeSignatureUrl: 'https://example.com/fin.png',
      });
      expect(cashOpRow.status).toBe('REALISASI_PENDING_GM');
      expect(cashOpRow.realisasiStatus).toBe('PENDING_GM_REVIEW');
      expect(cashOpRow.realisasiNomorRekeningFinance).toBe('BCA-456');
      expect(notifications.createForRole).toHaveBeenCalledWith(
        Role.GENERAL_MANAGER,
        expect.objectContaining({ title: expect.stringContaining('Siap Diperiksa') })
      );
    });

    it('sets DONE when no next step after Finance', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      steps = []; // Finance is last (edge case / legacy)
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: 'BRI-789',
        financeSignatureUrl: 'https://example.com/fin.png',
      });
      expect(cashOpRow.status).toBe('REALISASI_DONE');
      expect(cashOpRow.realisasiCompletedAt).toBeInstanceOf(Date);
    });

    it('approves without financeSignatureUrl', async () => {
      cashOpRow.status = 'REALISASI_PENDING_FINANCE';
      steps = [
        { id: 'st-gm', cashOpRequestId: 'co1', stepOrder: 1, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
      ];
      prisma.user.findUnique.mockResolvedValueOnce({ role: Role.FINANCE, id: 'fin1' });
      await service.editAndApproveByFinance('co1', 'fin1', {
        nomorRekeningFinance: 'BCA-123',
      });
      expect(cashOpRow.status).toBe('REALISASI_PENDING_GM');
    });
  });
});
