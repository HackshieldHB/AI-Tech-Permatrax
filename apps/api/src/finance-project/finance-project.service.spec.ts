import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BudgetLedgerEntryType,
  FinanceProjectStatus,
  Prisma,
} from '@prisma/client';
import { FinanceProjectService } from './finance-project.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateFinanceProjectDto } from './finance-project.dto';

describe('FinanceProjectService', () => {
  let service: FinanceProjectService;

  const tx = {
    financeProject: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    budgetLedger: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    budgetTransfer: {
      count: jest.fn(),
    },
  };

  const prisma = {
    financeProject: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    budgetLedger: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      findFirst: jest.fn(),
    },
    budgetTransfer: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (t: typeof tx) => Promise<unknown>)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceProjectService,
        BudgetLedgerService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { notifyBudgetThresholdAlerts: jest.fn() } },
      ],
    }).compile();

    service = module.get(FinanceProjectService);
  });

  it('CreateFinanceProjectDto rejects material+jasa > total', () => {
    const r = CreateFinanceProjectDto.safeParse({
      name: 'Proyek Uji',
      totalBudget: 100,
      materialBudget: 60,
      jasaBudget: 50,
    });
    expect(r.success).toBe(false);
  });

  describe('create', () => {
    const baseDto = {
      name: 'Proyek Uji',
      totalBudget: 1000,
      materialBudget: 600,
      jasaBudget: 400,
    };

    it('happy path → project + BUDGET_INIT', async () => {
      tx.financeProject.findMany.mockResolvedValue([]);
      const created = {
        id: 'p-new',
      code: 'FIN-2026-001',
        name: baseDto.name,
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
        createdById: 'u1',
        updatedById: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      tx.financeProject.create.mockResolvedValue(created);

      const out = await service.create(baseDto, 'u1');

      expect(out.id).toBe('p-new');
      expect(tx.budgetLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: BudgetLedgerEntryType.BUDGET_INIT,
            financeProjectId: 'p-new',
          }),
        }),
      );
    });

    it('auto code FIN-YYYY-NNN from empty findMany', async () => {
      tx.financeProject.findMany.mockResolvedValue([]);
      tx.financeProject.create.mockImplementation(async (args: { data: { code: string } }) => ({
        id: 'id',
        ...args.data,
      }));
      await service.create(
        { name: 'X', totalBudget: 100, materialBudget: undefined, jasaBudget: undefined },
        'u1',
      );
      const code = tx.financeProject.create.mock.calls[0][0].data.code as string;
      expect(code).toMatch(/^FIN-\d{4}-\d{3}$/);
    });

    it('collision retry on P2002 without manual code', async () => {
      let calls = 0;
      tx.financeProject.findMany.mockResolvedValue([]);
      tx.financeProject.create.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Prisma.PrismaClientKnownRequestError('u', {
            code: 'P2002',
            clientVersion: 't',
          } as never);
        }
        return {
          id: 'ok',
          code: 'FIN-2026-002',
          name: 'X',
        };
      });
      const out = await service.create({ name: 'X', totalBudget: 10 }, 'u1');
      expect(calls).toBe(2);
      expect(out.code).toBeDefined();
    });

    it('user override code', async () => {
      tx.financeProject.create.mockImplementation(async (args: { data: { code: string } }) => ({
        id: 'i',
        code: args.data.code,
      }));
      await service.create({ name: 'X', totalBudget: 1, code: 'MY-PROJ-1' }, 'u1');
      expect(tx.financeProject.create.mock.calls[0][0].data.code).toBe('MY-PROJ-1');
    });
  });

  describe('update', () => {
    it('blocks name, description, endDate on GENERAL', async () => {
      prisma.financeProject.findUnique.mockResolvedValue({
        id: 'g',
        isDefaultUncategorized: true,
        status: FinanceProjectStatus.ACTIVE,
      });
      await expect(service.update('g', { name: 'X' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update('g', { description: 'Y' }, 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.update('g', { endDate: null }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks archive/close on GENERAL', async () => {
      prisma.financeProject.findUnique.mockResolvedValue({
        id: 'g',
        isDefaultUncategorized: true,
        status: FinanceProjectStatus.ACTIVE,
      });
      await expect(
        service.update('g', { status: FinanceProjectStatus.ARCHIVED }, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update('g', { status: FinanceProjectStatus.CLOSED }, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('valid status transition ACTIVE → CLOSED', async () => {
      prisma.financeProject.findUnique.mockResolvedValue({
        id: 'p',
        isDefaultUncategorized: false,
        status: FinanceProjectStatus.ACTIVE,
      });
      prisma.financeProject.update.mockResolvedValue({});
      await expect(
        service.update('p', { status: FinanceProjectStatus.CLOSED }, 'u'),
      ).resolves.toBeDefined();
    });

    it('menolak arsip jika ada transfer budget pending', async () => {
      prisma.financeProject.findUnique.mockResolvedValue({
        id: 'p',
        isDefaultUncategorized: false,
        status: FinanceProjectStatus.CLOSED,
      });
      prisma.budgetTransfer.count.mockResolvedValue(1);
      await expect(
        service.update('p', { status: FinanceProjectStatus.ARCHIVED }, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateBudget', () => {
    const baseCur = {
      id: 'p',
      isDefaultUncategorized: false,
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(600),
      jasaBudget: new Prisma.Decimal(400),
      materialSpent: new Prisma.Decimal(300),
      jasaSpent: new Prisma.Decimal(200),
    };

    it('rejects new total < spent sum (OQ9)', async () => {
      prisma.financeProject.findUnique.mockResolvedValue(baseCur);
      await expect(
        service.updateBudget('p', { totalBudget: 400 }, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates BUDGET_ADJUSTMENT with snapshot metadata', async () => {
      prisma.financeProject.findUnique.mockResolvedValue(baseCur);
      tx.financeProject.update
        .mockResolvedValueOnce({
          ...baseCur,
          totalBudget: new Prisma.Decimal(2000),
        })
        .mockResolvedValueOnce({
          ...baseCur,
          totalBudget: new Prisma.Decimal(2000),
          isOverbudget: false,
        });

      await service.updateBudget(
        'p',
        {
          totalBudget: 2000,
          reason: 'scope change',
        },
        'u',
      );

      expect(tx.budgetLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: BudgetLedgerEntryType.BUDGET_ADJUSTMENT,
            metadata: expect.objectContaining({
              previous: expect.any(Object),
              next: expect.any(Object),
              reason: 'scope change',
            }),
          }),
        }),
      );
    });

    it('GENERAL cannot adjust budget', async () => {
      prisma.financeProject.findUnique.mockResolvedValue({
        ...baseCur,
        isDefaultUncategorized: true,
      });
      await expect(
        service.updateBudget('p', { totalBudget: 5000 }, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      prisma.financeProject.findUnique.mockResolvedValue(null);
      await expect(service.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('includes activityStats from ledger aggregates', async () => {
      const row = {
        id: 'a',
        code: 'C',
        name: 'N',
        description: null,
        totalBudget: new Prisma.Decimal(100),
        materialBudget: null,
        jasaBudget: null,
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
        isOverbudget: false,
        isDefaultUncategorized: false,
        endDate: null,
        status: FinanceProjectStatus.ACTIVE,
        createdById: 'u',
        updatedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.financeProject.findUnique.mockResolvedValue(row);
      prisma.budgetTransfer.count.mockResolvedValue(0);
      prisma.budgetLedger.findMany.mockResolvedValue([]);
      prisma.budgetLedger.groupBy.mockResolvedValue([
        { entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL, _count: { _all: 2 } },
        { entryType: BudgetLedgerEntryType.REFUND_MATERIAL, _count: { _all: 1 } },
      ]);
      prisma.budgetLedger.findFirst.mockResolvedValue({
        createdAt: new Date('2026-01-15'),
        entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
      });

      const d = await service.findOne('a');

      expect(d.activityStats.totalTransactions).toBe(3);
      expect(d.activityStats.deductCount).toBe(2);
      expect(d.activityStats.refundCount).toBe(1);
      expect(d.activityStats.lastActivityType).toBe(BudgetLedgerEntryType.DEDUCT_MATERIAL);
    });
  });
});
