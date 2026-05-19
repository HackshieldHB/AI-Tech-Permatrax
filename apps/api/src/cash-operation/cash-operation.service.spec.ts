import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { CashOperationService } from './cash-operation.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetLedgerService, CashOpPartialRefundType } from '../budget-ledger/budget-ledger.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('CashOperationService', () => {
  let service: CashOperationService;
  let approvalFindManyResult: Array<{ approvedAmount: Prisma.Decimal | null }>;

  const prisma = {
    cashOperationRequest: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'new-ca-id' })),
    },
    cashOpApprovalStep: {
      update: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      if (typeof arg === 'function') return (arg as (t: unknown) => Promise<unknown>)(prisma);
      return Promise.resolve();
    }),
  };

  const gateway = { emitToRoom: jest.fn() };
  const storage = {};
  const notificationsService = {
    notifyUsersByRole: jest.fn(),
    createForUser: jest.fn(),
  };
  const budgetLedger = {
    resolveProjectId: jest.fn(),
    deductForCashOp: jest.fn(),
    afterDeductNotifyCashOp: jest.fn(),
    utilizationFromProject: jest.fn().mockReturnValue({ material: 0.05, jasa: 0.05 }),
    refundForCashOp: jest.fn(),
    partialRefundForCashOp: jest.fn(),
  };

  const chainCompleteReq = {
    id: 'r1',
    type: 'CASH_ADVANCE' as const,
    requestNumber: 'CA-2026-0001',
    amount: new Prisma.Decimal(500_000),
    financeProjectId: null as string | null,
    requestedBy: 'req1',
    slaDeadline: null as Date | null,
    approvalHistory: [] as Prisma.JsonValue,
    approvalChain: ['PM_FTTH', 'FINANCE'] as unknown as Prisma.JsonValue,
    currentStep: 1,
    currentStepRole: 'FINANCE',
    approvalSteps: [
      { id: 'st0', approverRole: 'PM_FTTH', status: 'APPROVED', stepOrder: 1 },
      { id: 'st1', approverRole: 'FINANCE', status: 'PENDING', stepOrder: 2 },
    ],
    requester: { id: 'req1', name: 'User', role: Role.PM_FTTH },
  };

  const chainProgressReq = {
    ...chainCompleteReq,
    approvalChain: ['PM_FTTH', 'ADMIN', 'FINANCE'] as unknown as Prisma.JsonValue,
    currentStep: 1,
    currentStepRole: 'ADMIN',
    approvalSteps: [
      { id: 'st0', approverRole: 'PM_FTTH', status: 'APPROVED', stepOrder: 1 },
      { id: 'st1', approverRole: 'ADMIN', status: 'PENDING', stepOrder: 2 },
      { id: 'st2', approverRole: 'FINANCE', status: 'PENDING', stepOrder: 3 },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    approvalFindManyResult = [];

    prisma.cashOperationRequest.findUniqueOrThrow.mockImplementation(async (args: { where: { id: string } }) => {
      const row = await prisma.cashOperationRequest.findUnique(args);
      if (!row) throw new Error('Not found');
      return row;
    });

    (runSerializableTransaction as jest.Mock).mockImplementation(
      async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          cashOpApprovalStep: {
            findMany: jest.fn().mockImplementation(async () => approvalFindManyResult),
            update: prisma.cashOpApprovalStep.update,
          },
          cashOperationRequest: prisma.cashOperationRequest,
          financeProject: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'fp1',
              totalBudget: new Prisma.Decimal(1_000_000),
              materialBudget: new Prisma.Decimal(500_000),
              jasaBudget: new Prisma.Decimal(500_000),
              materialSpent: new Prisma.Decimal(0),
              jasaSpent: new Prisma.Decimal(0),
            }),
          },
        }),
    );

    budgetLedger.resolveProjectId.mockResolvedValue('fp-def');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashOperationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: StorageService, useValue: storage },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: BudgetLedgerService, useValue: budgetLedger },
      ],
    }).compile();

    service = module.get(CashOperationService);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'r1' } as Awaited<ReturnType<CashOperationService['findOne']>>);
  });

  const baseDraftCa = {
    id: 's1',
    type: 'CASH_ADVANCE' as const,
    status: 'DRAFT' as const,
    requestedBy: 'u1',
    amount: new Prisma.Decimal(100_000),
    photoUrls: null,
    attachments: [] as unknown[],
    requester: { id: 'u1', name: 'A', role: Role.PM_FTTH },
    requestNumber: 'CA-1',
    description: 'd',
    approvalHistory: [] as Prisma.JsonValue,
    nomorRekeningPengaju: '1234567890',
  };

  it('submit CA tanpa periode → 400', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...baseDraftCa,
      periodeFrom: null,
      periodeTo: null,
    } as never);

    await expect(service.submit('s1', 'u1')).rejects.toMatchObject({
      message: 'Cash Advance harus memiliki periode penggunaan',
    });
  });

  it('submit CA dengan periode di masa lalu → 400', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...baseDraftCa,
      periodeFrom: new Date('2020-01-01'), // past date
      periodeTo: new Date('2020-01-31'),
      nomorRekeningPengaju: '1234567890',
    } as never);

    await expect(service.submit('s1', 'u1')).rejects.toMatchObject({
      message: 'Periode mulai tidak boleh di masa lalu',
    });
  });

  it('submit CA dengan periodeTo < periodeFrom → 400', async () => {
    const futureFrom = new Date();
    futureFrom.setDate(futureFrom.getDate() + 5);
    const futureTo = new Date();
    futureTo.setDate(futureTo.getDate() + 1); // before from
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...baseDraftCa,
      periodeFrom: futureFrom,
      periodeTo: futureTo,
      nomorRekeningPengaju: '1234567890',
    } as never);

    await expect(service.submit('s1', 'u1')).rejects.toMatchObject({
      message: 'Periode selesai tidak boleh mendahului periode mulai',
    });
  });

  it('submit CA nominal ≤ 0 → 400', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const futureEndDate = new Date();
    futureEndDate.setDate(futureEndDate.getDate() + 30);
    
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...baseDraftCa,
      amount: new Prisma.Decimal(0),
      periodeFrom: futureDate,
      periodeTo: futureEndDate,
      nomorRekeningPengaju: '1234567890',
    } as never);

    await expect(service.submit('s1', 'u1')).rejects.toMatchObject({
      message: 'Nominal harus lebih dari 0',
    });
  });

  it('submit CA valid → memanggil transaction', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const futureEndDate = new Date();
    futureEndDate.setDate(futureEndDate.getDate() + 30);

    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...baseDraftCa,
      periodeFrom: futureDate,
      periodeTo: futureEndDate,
      nomorRekeningPengaju: '1234567890',
    } as never);

    await service.submit('s1', 'u1');

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('approve chain complete (CA) → deduct final approved amount', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue(chainCompleteReq);
    prisma.cashOpApprovalStep.update.mockResolvedValue({});
    prisma.cashOperationRequest.update.mockResolvedValue({});

    await service.approve('r1', { action: 'APPROVE', notes: 'ok' }, 'fin-user', Role.FINANCE);

    expect(budgetLedger.deductForCashOp).toHaveBeenCalledWith(
      'r1',
      'fp-def',
      new Prisma.Decimal(500_000),
      'fin-user',
      'req1',
      expect.anything(),
    );
    expect(budgetLedger.partialRefundForCashOp).not.toHaveBeenCalled();
    expect(budgetLedger.afterDeductNotifyCashOp).toHaveBeenCalledWith(
      'fp-def',
      expect.anything(),
      'fin-user',
      'req1',
      new Prisma.Decimal(500_000),
    );
  });

  it('approve chain complete (REIMBURSEMENT) with lower final → deduct request + variance partial refund', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...chainCompleteReq,
      type: 'REIMBURSEMENT' as const,
    });
    prisma.cashOpApprovalStep.update.mockResolvedValue({});
    prisma.cashOperationRequest.update.mockResolvedValue({});

    await service.approve(
      'r1',
      { action: 'APPROVE', notes: 'ok', approvedAmount: 400_000 },
      'fin-user',
      Role.FINANCE,
    );

    expect(budgetLedger.deductForCashOp).toHaveBeenCalledWith(
      'r1',
      'fp-def',
      new Prisma.Decimal(500_000),
      'fin-user',
      'req1',
      expect.anything(),
    );
    expect(budgetLedger.partialRefundForCashOp).toHaveBeenCalledWith(
      'r1',
      new Prisma.Decimal(100_000),
      expect.stringContaining('Selisih'),
      'fin-user',
      CashOpPartialRefundType.REIMBURSEMENT_VARIANCE,
      expect.anything(),
    );
  });

  it('approve chain complete (REIMBURSEMENT) final equals request → no partial refund', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      ...chainCompleteReq,
      type: 'REIMBURSEMENT' as const,
    });
    prisma.cashOpApprovalStep.update.mockResolvedValue({});
    prisma.cashOperationRequest.update.mockResolvedValue({});

    await service.approve('r1', { action: 'APPROVE', notes: 'ok' }, 'fin-user', Role.FINANCE);

    expect(budgetLedger.deductForCashOp).toHaveBeenCalledWith(
      'r1',
      'fp-def',
      new Prisma.Decimal(500_000),
      'fin-user',
      'req1',
      expect.anything(),
    );
    expect(budgetLedger.partialRefundForCashOp).not.toHaveBeenCalled();
  });

  it('approve chain not complete → no deduct', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue(chainProgressReq);
    prisma.cashOpApprovalStep.update.mockResolvedValue({});
    prisma.cashOperationRequest.update.mockResolvedValue({});

    await service.approve('r1', { action: 'APPROVE' }, 'adm', Role.ADMIN);

    expect(budgetLedger.deductForCashOp).not.toHaveBeenCalled();
    expect(budgetLedger.afterDeductNotifyCashOp).not.toHaveBeenCalled();
  });

  it('approve mid-chain: approvedAmount cannot exceed previous step ceiling', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue(chainProgressReq);
    approvalFindManyResult = [{ approvedAmount: new Prisma.Decimal(300_000) }];
    prisma.cashOpApprovalStep.update.mockResolvedValue({});

    await expect(
      service.approve('r1', { action: 'APPROVE', approvedAmount: 400_000 }, 'adm', Role.ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(budgetLedger.deductForCashOp).not.toHaveBeenCalled();
  });

  it('approve mid-chain: approvedAmount below ceiling is accepted', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue(chainProgressReq);
    approvalFindManyResult = [{ approvedAmount: new Prisma.Decimal(300_000) }];
    prisma.cashOpApprovalStep.update.mockResolvedValue({});
    prisma.cashOperationRequest.update.mockResolvedValue({});

    await service.approve('r1', { action: 'APPROVE', approvedAmount: 250_000 }, 'adm', Role.ADMIN);

    expect(prisma.cashOpApprovalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvedAmount: new Prisma.Decimal(250_000) }),
      }),
    );
    expect(budgetLedger.deductForCashOp).not.toHaveBeenCalled();
  });

  it('approve rejects approvedAmount ≤ 0', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue(chainProgressReq);
    approvalFindManyResult = [{ approvedAmount: new Prisma.Decimal(300_000) }];

    await expect(
      service.approve('r1', { action: 'APPROVE', approvedAmount: 0 }, 'adm', Role.ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reject pre-APPROVED → refund tidak dipanggil (belum ada deduct)', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue(chainProgressReq);
    prisma.cashOpApprovalStep.update.mockResolvedValue({});
    prisma.cashOperationRequest.update.mockResolvedValue({});
    (runSerializableTransaction as jest.Mock).mockImplementation(async () => undefined);

    await service.approve('r1', { action: 'REJECT', notes: 'no' }, 'adm', Role.ADMIN);

    expect(budgetLedger.refundForCashOp).not.toHaveBeenCalled();
  });

  it('disburse ditolak untuk record baru (finalApprovedAmount terisi)', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'APPROVED',
      type: 'CASH_ADVANCE',
      finalApprovedAmount: new Prisma.Decimal(100),
      requestedBy: 'u1',
    } as never);

    await expect(
      service.disburse('r1', { disbursedAmount: 100 }, 'fin', Role.FINANCE),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('disburse ditolak untuk reimbursement non-legacy dengan pesan sesuai', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'APPROVED',
      type: 'REIMBURSEMENT',
      finalApprovedAmount: new Prisma.Decimal(100),
      requestedBy: 'u1',
    } as never);

    await expect(
      service.disburse('r1', { disbursedAmount: 100 }, 'fin', Role.FINANCE),
    ).rejects.toMatchObject({
      message: 'Reimbursement otomatis disetujui setelah approval, tidak perlu pencairan terpisah.',
    });
  });

  it('disburse legacy (finalApprovedAmount null) tetap diizinkan', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'APPROVED',
      type: 'CASH_ADVANCE',
      finalApprovedAmount: null,
      requestedBy: 'u1',
    } as never);
    prisma.cashOperationRequest.update.mockResolvedValue({ id: 'r1', requestedBy: 'u1' } as never);

    const out = await service.disburse('r1', { disbursedAmount: 50 }, 'fin', Role.FINANCE);

    expect(prisma.cashOperationRequest.update).toHaveBeenCalled();
    expect(out).toEqual(expect.objectContaining({ id: 'r1' }));
  });

  it('disburse hanya untuk role FINANCE', async () => {
    prisma.cashOperationRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'APPROVED',
      finalApprovedAmount: null,
    } as never);

    await expect(
      service.disburse('r1', { disbursedAmount: 50 }, 'gm', Role.GENERAL_MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('Issue C: nomorRekeningPengaju validation', () => {
    it('create CA tanpa nomorRekeningPengaju → 400', async () => {
      await expect(
        service.create(
          {
            type: 'CASH_ADVANCE',
            title: 'Test CA',
            description: 'Test',
            amount: 100000,
            totalAmount: 100000,
            periodeFrom: new Date().toISOString(),
            periodeTo: new Date(Date.now() + 86400000).toISOString(),
            // nomorRekeningPengaju intentionally missing
          } as any,
          'u1',
          Role.PM_FTTH,
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Nomor rekening wajib diisi'),
      });
    });

    it('submit CA tanpa nomorRekeningPengaju → 400', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureEndDate = new Date();
      futureEndDate.setDate(futureEndDate.getDate() + 30);

      prisma.cashOperationRequest.findUnique.mockResolvedValue({
        ...baseDraftCa,
        type: 'CASH_ADVANCE',
        periodeFrom: futureDate,
        periodeTo: futureEndDate,
        nomorRekeningPengaju: null,
      } as never);

      await expect(service.submit('s1', 'u1')).rejects.toMatchObject({
        message: expect.stringContaining('Nomor rekening wajib diisi'),
      });
    });

    it('submit CA dengan nomorRekeningPengaju → berhasil', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureEndDate = new Date();
      futureEndDate.setDate(futureEndDate.getDate() + 30);

      prisma.cashOperationRequest.findUnique.mockResolvedValue({
        ...baseDraftCa,
        type: 'CASH_ADVANCE',
        periodeFrom: futureDate,
        periodeTo: futureEndDate,
        nomorRekeningPengaju: '1234567890',
      } as never);

      await service.submit('s1', 'u1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
