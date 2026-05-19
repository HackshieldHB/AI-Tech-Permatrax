import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BudgetLedgerCategory,
  BudgetTransferStatus,
  FinanceProjectStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { BudgetTransferService } from './budget-transfer.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

const projectBase = {
  id: 's1',
  code: 'S1',
  name: 'Src',
  description: null,
  totalBudget: new Prisma.Decimal(1000),
  materialBudget: new Prisma.Decimal(600),
  jasaBudget: new Prisma.Decimal(400),
  materialSpent: new Prisma.Decimal(0),
  jasaSpent: new Prisma.Decimal(0),
  isOverbudget: false,
  isDefaultUncategorized: false,
  endDate: null,
  status: FinanceProjectStatus.ACTIVE,
  createdById: 'u',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BudgetTransferService', () => {
  let service: BudgetTransferService;

  const prisma = {
    financeProject: { findUnique: jest.fn() },
    budgetTransfer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    budgetLedger: { createMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const ledger = {
    getRemainingByCategory: jest.fn(),
    utilizationFromProject: jest.fn().mockReturnValue({ material: 0.1, jasa: 0.1 }),
    checkAndNotifyThresholds: jest.fn().mockResolvedValue(undefined),
    syncOverbudgetInTx: jest.fn().mockResolvedValue(undefined),
    getMaterialCap: jest.fn(),
    getJasaCap: jest.fn(),
    getMaterialRemaining: jest.fn(),
    getJasaRemaining: jest.fn(),
  };

  const notifications = {
    notifyUsersByRole: jest.fn().mockResolvedValue(undefined),
    createForUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (runSerializableTransaction as jest.Mock).mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetTransferService,
        { provide: PrismaService, useValue: prisma },
        { provide: BudgetLedgerService, useValue: ledger },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(BudgetTransferService);
  });

  it('submit: menolak jika proyek sumber diarsipkan', async () => {
    prisma.financeProject.findUnique
      .mockResolvedValueOnce({ ...projectBase, status: FinanceProjectStatus.ARCHIVED })
      .mockResolvedValueOnce({ ...projectBase, id: 't1', status: FinanceProjectStatus.ACTIVE });
    await expect(
      service.submit(
        {
          sourceFinanceProjectId: 's',
          targetFinanceProjectId: 't',
          sourceCategory: 'MATERIAL',
          targetCategory: 'JASA',
          amount: 10,
          reason: 'test transfer reason',
        },
        'fin1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submit: sisa tidak cukup → 400', async () => {
    prisma.financeProject.findUnique
      .mockResolvedValueOnce({ ...projectBase })
      .mockResolvedValueOnce({ ...projectBase, id: 't1' });
    ledger.getRemainingByCategory.mockReturnValue(new Prisma.Decimal(5));
    await expect(
      service.submit(
        {
          sourceFinanceProjectId: 's1',
          targetFinanceProjectId: 't1',
          sourceCategory: 'MATERIAL',
          targetCategory: 'MATERIAL',
          amount: 50,
          reason: 'alasan transfer yang cukup panjang',
        },
        'fin1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submit: happy path + notif GM', async () => {
    prisma.financeProject.findUnique
      .mockResolvedValueOnce({ ...projectBase })
      .mockResolvedValueOnce({ ...projectBase, id: 't1', code: 'T1' });
    ledger.getRemainingByCategory.mockReturnValue(new Prisma.Decimal(500));
    prisma.budgetTransfer.create.mockResolvedValue({
      id: 'tr1',
      status: BudgetTransferStatus.PENDING_GM_APPROVAL,
    });
    const out = await service.submit(
      {
        sourceFinanceProjectId: 's1',
        targetFinanceProjectId: 't1',
        sourceCategory: 'MATERIAL',
        targetCategory: 'JASA',
        amount: 50,
        reason: 'alasan transfer yang valid',
      },
      'fin1',
    );
    expect(out.status).toBe(BudgetTransferStatus.PENDING_GM_APPROVAL);
    expect(notifications.notifyUsersByRole).toHaveBeenCalledWith(
      Role.GENERAL_MANAGER,
      expect.objectContaining({ title: expect.stringContaining('Transfer') }),
    );
  });

  it('approve: kedua kali → konflik', async () => {
    prisma.budgetTransfer.findUnique.mockResolvedValue({
      id: 'tr1',
      sourceFinanceProjectId: 's1',
      targetFinanceProjectId: 't1',
      sourceCategory: BudgetLedgerCategory.MATERIAL,
      targetCategory: BudgetLedgerCategory.JASA,
      amount: new Prisma.Decimal(10),
      status: BudgetTransferStatus.PENDING_GM_APPROVAL,
      submittedById: 'sub',
      reason: 'x',
    });
    prisma.financeProject.findUnique.mockResolvedValue({ ...projectBase });
    (runSerializableTransaction as jest.Mock).mockImplementation(async (_, fn) =>
      fn({
        $queryRaw: jest.fn().mockResolvedValue([]),
        budgetTransfer: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'tr1',
            status: BudgetTransferStatus.APPROVED,
            sourceFinanceProjectId: 's1',
            targetFinanceProjectId: 't1',
          }),
        },
      }),
    );
    await expect(service.approveByGm('tr1', 'gm1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('reject: happy path + notif', async () => {
    prisma.budgetTransfer.findUnique.mockResolvedValue({
      id: 'tr1',
      status: BudgetTransferStatus.PENDING_GM_APPROVAL,
      submittedById: 'sub',
    });
    prisma.budgetTransfer.update.mockResolvedValue({ id: 'tr1', status: BudgetTransferStatus.REJECTED });
    await service.rejectByGm('tr1', 'gm1', 'kurang rincian');
    expect(notifications.createForUser).toHaveBeenCalledWith('sub', expect.any(Object));
  });

  it('cancel: non-submitter → 403', async () => {
    prisma.budgetTransfer.findUnique.mockResolvedValue({
      id: 'tr1',
      submittedById: 'sub',
      status: BudgetTransferStatus.PENDING_GM_APPROVAL,
    });
    await expect(service.cancelBySubmitter('tr1', 'other')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOne: tidak ada → 404', async () => {
    prisma.budgetTransfer.findUnique.mockResolvedValue(null);
    await expect(service.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approve: happy path menjalankan serializable callback', async () => {
    const transferRow = {
      id: 'tr1',
      sourceFinanceProjectId: 's1',
      targetFinanceProjectId: 't1',
      sourceCategory: BudgetLedgerCategory.MATERIAL,
      targetCategory: BudgetLedgerCategory.JASA,
      amount: new Prisma.Decimal(100),
      status: BudgetTransferStatus.PENDING_GM_APPROVAL,
      submittedById: 'sub',
      reason: 'r',
    };
    const src = { ...projectBase, id: 's1' };
    const tgt = { ...projectBase, id: 't1', materialBudget: new Prisma.Decimal(500), jasaBudget: new Prisma.Decimal(500) };

    prisma.budgetTransfer.findUnique.mockResolvedValue(transferRow);
    prisma.financeProject.findUnique.mockResolvedValueOnce({ ...src }).mockResolvedValueOnce({ ...tgt });

    const mockTx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      budgetTransfer: {
        findUnique: jest.fn().mockResolvedValue(transferRow),
        update: jest.fn().mockResolvedValue({ ...transferRow, status: BudgetTransferStatus.APPROVED }),
      },
      financeProject: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ ...src })
          .mockResolvedValueOnce({ ...tgt }),
        update: jest.fn().mockResolvedValue({}),
      },
      budgetLedger: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    (runSerializableTransaction as jest.Mock).mockImplementation(
      async (_p: unknown, fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );

    ledger.getRemainingByCategory.mockReturnValue(new Prisma.Decimal(500));

    const out = await service.approveByGm('tr1', 'gm1', 'ok');
    expect(out.status).toBe(BudgetTransferStatus.APPROVED);
    expect(mockTx.budgetLedger.createMany).toHaveBeenCalled();
    expect(ledger.checkAndNotifyThresholds).toHaveBeenCalledTimes(2);
  });
});
