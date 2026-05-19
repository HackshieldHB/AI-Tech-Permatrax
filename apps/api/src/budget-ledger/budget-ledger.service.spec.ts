import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BudgetLedgerEntryType,
  BudgetLedgerSourceType,
  FinanceProjectStatus,
} from '@prisma/client';
import {
  BudgetLedgerService,
  CashOpPartialRefundType,
} from './budget-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const runSerializableTransaction = jest.fn();
jest.mock('./transaction-retry.util', () => ({
  runSerializableTransaction: (prisma: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    runSerializableTransaction(prisma, fn),
}));

describe('BudgetLedgerService', () => {
  let service: BudgetLedgerService;

  const notifications = {
    notifyBudgetThresholdAlerts: jest.fn().mockResolvedValue(undefined),
  };

  const ledgerStore: Array<{
    sourceType: string;
    sourceId: string;
    entryType: string;
    financeProjectId: string;
    amount: Prisma.Decimal;
    metadata?: Prisma.JsonValue;
  }> = [];

  let materialSpent = new Prisma.Decimal(0);
  let jasaSpent = new Prisma.Decimal(0);
  let projectRow: Record<string, unknown>;

  const buildMockTx = () => ({
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'p1' }]),
    budgetLedger: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        return ledgerStore.filter(
          (r) =>
            r.sourceType === w.sourceType &&
            r.sourceId === w.sourceId &&
            r.entryType === (w.entryType as string),
        );
      }),
      findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        return ledgerStore.find(
          (r) =>
            r.sourceType === w.sourceType &&
            r.sourceId === w.sourceId &&
            r.entryType === (w.entryType as string),
        ) ?? null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        ledgerStore.push({
          sourceType: args.data.sourceType as string,
          sourceId: args.data.sourceId as string,
          entryType: args.data.entryType as string,
          financeProjectId: args.data.financeProjectId as string,
          amount: args.data.amount as Prisma.Decimal,
          metadata: args.data.metadata as Prisma.JsonValue | undefined,
        });
      }),
    },
    financeProject: {
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({
        ...projectRow,
        materialSpent,
        jasaSpent,
        totalBudget: projectRow.totalBudget,
        materialBudget: projectRow.materialBudget,
        jasaBudget: projectRow.jasaBudget,
      })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const inc = args.data.materialSpent as { increment?: Prisma.Decimal } | undefined;
        if (inc?.increment) {
          materialSpent = materialSpent.plus(inc.increment);
        }
        const jinc = args.data.jasaSpent as { increment?: Prisma.Decimal } | undefined;
        if (jinc?.increment) {
          jasaSpent = jasaSpent.plus(jinc.increment);
        }
        const ms = args.data.materialSpent;
        if (ms != null && !(typeof ms === 'object' && 'increment' in ms)) {
          materialSpent = ms as Prisma.Decimal;
        }
        const js = args.data.jasaSpent;
        if (js != null && !(typeof js === 'object' && 'increment' in js)) {
          jasaSpent = js as Prisma.Decimal;
        }
        if (args.data.isOverbudget != null) {
          projectRow.isOverbudget = args.data.isOverbudget;
        }
      }),
    },
  });

  let mockTx: ReturnType<typeof buildMockTx>;

  const prisma = {
    financeProject: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ledgerStore.length = 0;
    materialSpent = new Prisma.Decimal(0);
    jasaSpent = new Prisma.Decimal(0);
    projectRow = {
      id: 'p1',
      code: 'P',
      name: 'Test',
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(600),
      jasaBudget: new Prisma.Decimal(400),
      materialSpent,
      jasaSpent,
      isOverbudget: false,
      isDefaultUncategorized: false,
      status: FinanceProjectStatus.ACTIVE,
    };

    mockTx = buildMockTx();
    runSerializableTransaction.mockImplementation(async (_p: unknown, fn: (tx: unknown) => Promise<void>) =>
      fn(mockTx),
    );

    prisma.financeProject.findFirst.mockResolvedValue({ id: 'gen' });
    prisma.financeProject.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'bad') return null;
      return {
        ...projectRow,
        materialSpent,
        jasaSpent,
      };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetLedgerService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(BudgetLedgerService);
  });

  describe('resolveProjectId', () => {
    it('null → GENERAL id', async () => {
      const id = await service.resolveProjectId(null);
      expect(id).toBe('gen');
      expect(prisma.financeProject.findFirst).toHaveBeenCalled();
    });

    it('valid id → as-is', async () => {
      await expect(service.resolveProjectId('p1')).resolves.toBe('p1');
    });

    it('invalid id → NotFoundException', async () => {
      await expect(service.resolveProjectId('bad')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getMaterialRemaining / getJasaRemaining', () => {
    it('material: both material and jasa set', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: new Prisma.Decimal(60),
        jasaBudget: new Prisma.Decimal(40),
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getMaterialRemaining(p).toNumber()).toBe(50);
    });

    it('material: material null, jasa set (fallback)', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: null,
        jasaBudget: new Prisma.Decimal(40),
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getMaterialRemaining(p).toNumber()).toBe(50);
    });

    it('material: jasa null, material set (bucket = explicit material)', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: new Prisma.Decimal(60),
        jasaBudget: null,
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getMaterialRemaining(p).toNumber()).toBe(50);
    });

    it('material: both null (split total)', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: null,
        jasaBudget: null,
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getMaterialRemaining(p).toNumber()).toBe(85);
    });

    it('jasa: both set', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: new Prisma.Decimal(60),
        jasaBudget: new Prisma.Decimal(40),
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getJasaRemaining(p).toNumber()).toBe(35);
    });

    it('jasa: material null, jasa set', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: null,
        jasaBudget: new Prisma.Decimal(40),
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getJasaRemaining(p).toNumber()).toBe(35);
    });

    it('jasa: jasa null, material set', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: new Prisma.Decimal(60),
        jasaBudget: null,
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getJasaRemaining(p).toNumber()).toBe(35);
    });

    it('jasa: both null', () => {
      const p = {
        totalBudget: new Prisma.Decimal(100),
        materialBudget: null,
        jasaBudget: null,
        materialSpent: new Prisma.Decimal(10),
        jasaSpent: new Prisma.Decimal(5),
      };
      expect(service.getJasaRemaining(p).toNumber()).toBe(85);
    });
  });

  describe('deductForOrder', () => {
    it('happy path → ledger + spent increment', async () => {
      await service.deductForOrder(
        'o1',
        'p1',
        new Prisma.Decimal(50),
        'actor',
        null,
      );
      expect(ledgerStore).toHaveLength(1);
      expect(ledgerStore[0].entryType).toBe(BudgetLedgerEntryType.DEDUCT_MATERIAL);
      expect(materialSpent.toNumber()).toBe(50);
    });

    it('idempotent: second call no extra row', async () => {
      await service.deductForOrder('o1', 'p1', new Prisma.Decimal(50), 'actor', null);
      expect(ledgerStore).toHaveLength(1);
      await service.deductForOrder('o1', 'p1', new Prisma.Decimal(50), 'actor', null);
      expect(ledgerStore).toHaveLength(1);
      expect(materialSpent.toNumber()).toBe(50);
    });

    it('race: P2002 on create → no increment', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockTx.budgetLedger.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' } as never),
      );
      await service.deductForOrder('o1', 'p1', new Prisma.Decimal(50), 'actor', null);
      expect(ledgerStore).toHaveLength(0);
      expect(materialSpent.toNumber()).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/deductForOrder: idempotent skip after unique conflict/),
      );
      warnSpy.mockRestore();
    });

    it('crossing 80% triggers WARN_80 with actor + creator (requester)', async () => {
      projectRow.totalBudget = new Prisma.Decimal(1000);
      projectRow.materialBudget = new Prisma.Decimal(100);
      materialSpent = new Prisma.Decimal(70);
      await service.deductForOrder('o2', 'p1', new Prisma.Decimal(15), 'actor', 'req');
      expect(notifications.notifyBudgetThresholdAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'WARN_80',
          categoryLabel: 'Material',
          notifyUserIds: ['actor', 'req'],
        }),
      );
    });

    it('creator sama actor → notifyUserIds dedup satu id', async () => {
      projectRow.totalBudget = new Prisma.Decimal(1000);
      projectRow.materialBudget = new Prisma.Decimal(100);
      materialSpent = new Prisma.Decimal(70);
      notifications.notifyBudgetThresholdAlerts.mockClear();
      await service.deductForOrder('o-dedup', 'p1', new Prisma.Decimal(15), 'u1', 'u1');
      expect(notifications.notifyBudgetThresholdAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'WARN_80',
          notifyUserIds: ['u1'],
        }),
      );
    });

    it('crossing 100% triggers OVERBUDGET', async () => {
      projectRow.totalBudget = new Prisma.Decimal(1000);
      projectRow.materialBudget = new Prisma.Decimal(100);
      materialSpent = new Prisma.Decimal(85);
      await service.deductForOrder('o3', 'p1', new Prisma.Decimal(20), 'actor', null);
      expect(notifications.notifyBudgetThresholdAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'OVERBUDGET',
          categoryLabel: 'Material',
          notifyUserIds: ['actor'],
        }),
      );
    });

    it('jump <80% to ≥100%: overbudget only (no WARN_80)', async () => {
      projectRow.totalBudget = new Prisma.Decimal(1000);
      projectRow.materialBudget = new Prisma.Decimal(100);
      materialSpent = new Prisma.Decimal(50);
      notifications.notifyBudgetThresholdAlerts.mockClear();
      await service.deductForOrder('o4', 'p1', new Prisma.Decimal(60), 'actor', null);
      const kinds = notifications.notifyBudgetThresholdAlerts.mock.calls.map((c) => c[0].kind);
      expect(kinds).toContain('OVERBUDGET');
      expect(kinds).not.toContain('WARN_80');
    });

    it('GENERAL: fires overbudget each deduct with amount > 0', async () => {
      projectRow.isDefaultUncategorized = true;
      projectRow.totalBudget = new Prisma.Decimal(0);
      projectRow.materialBudget = null;
      projectRow.jasaBudget = null;
      materialSpent = new Prisma.Decimal(0);
      notifications.notifyBudgetThresholdAlerts.mockClear();
      await service.deductForOrder('g1', 'p1', new Prisma.Decimal(1), 'actor', null);
      await service.deductForOrder('g2', 'p1', new Prisma.Decimal(1), 'actor', null);
      expect(notifications.notifyBudgetThresholdAlerts.mock.calls[0][0].notifyUserIds).toEqual(['actor']);
      expect(notifications.notifyBudgetThresholdAlerts.mock.calls[1][0].notifyUserIds).toEqual(['actor']);
    });
  });

  describe('refundForOrder', () => {
    beforeEach(() => {
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.ORDER,
        sourceId: 'o-ref',
        entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
        amount: new Prisma.Decimal(30),
      });
      materialSpent = new Prisma.Decimal(30);
    });

    it('happy path → REFUND + spent decrement', async () => {
      await service.refundForOrder('o-ref', 'actor', 'batal', mockTx as never);
      expect(ledgerStore.some((r) => r.entryType === BudgetLedgerEntryType.REFUND_MATERIAL)).toBe(true);
      expect(materialSpent.toNumber()).toBe(0);
    });

    it('no deduct → no-op', async () => {
      ledgerStore.length = 0;
      materialSpent = new Prisma.Decimal(0);
      await service.refundForOrder('missing', 'actor', 'x', mockTx as never);
      expect(ledgerStore).toHaveLength(0);
    });

    it('idempotent refund', async () => {
      await service.refundForOrder('o-ref', 'actor', 'a', mockTx as never);
      await service.refundForOrder('o-ref', 'actor', 'b', mockTx as never);
      expect(ledgerStore.filter((r) => r.entryType === BudgetLedgerEntryType.REFUND_MATERIAL)).toHaveLength(1);
    });
  });

  describe('deductForCashOp / refundForCashOp', () => {
    it('deduct happy path + jasa spent', async () => {
      await service.deductForCashOp('c1', 'p1', new Prisma.Decimal(25), 'actor', null);
      expect(ledgerStore[0].entryType).toBe(BudgetLedgerEntryType.DEDUCT_JASA);
      expect(jasaSpent.toNumber()).toBe(25);
    });

    it('idempotent: 2x deductForCashOp same cashOpId → single ledger row', async () => {
      await service.deductForCashOp('c-dup', 'p1', new Prisma.Decimal(20), 'actor', null);
      await service.deductForCashOp('c-dup', 'p1', new Prisma.Decimal(20), 'actor', null);
      expect(ledgerStore.filter((r) => r.sourceId === 'c-dup')).toHaveLength(1);
      expect(jasaSpent.toNumber()).toBe(20);
    });

    it('refund cash op', async () => {
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-ref',
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
        amount: new Prisma.Decimal(10),
      });
      jasaSpent = new Prisma.Decimal(10);
      await service.refundForCashOp('c-ref', 'actor', 'reason', mockTx as never);
      expect(ledgerStore.some((r) => r.entryType === BudgetLedgerEntryType.REFUND_JASA)).toBe(true);
      expect(jasaSpent.toNumber()).toBe(0);
    });

    it('refundForCashOp after partial REFUND_JASA (tagged) still posts full refund (OP1)', async () => {
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-mix',
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
        amount: new Prisma.Decimal(100),
      });
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-mix',
        entryType: BudgetLedgerEntryType.REFUND_JASA,
        amount: new Prisma.Decimal(25),
        metadata: { partialRefundType: CashOpPartialRefundType.REALISASI_VARIANCE },
      });
      jasaSpent = new Prisma.Decimal(75);
      await service.refundForCashOp('c-mix', 'actor', 'reason', mockTx as never);
      const untaggedFull = ledgerStore.filter(
        (r) =>
          r.entryType === BudgetLedgerEntryType.REFUND_JASA &&
          r.sourceId === 'c-mix' &&
          (!r.metadata ||
            (typeof r.metadata === 'object' &&
              !Array.isArray(r.metadata) &&
              !('partialRefundType' in (r.metadata as object)))),
      );
      expect(untaggedFull).toHaveLength(1);
      expect(untaggedFull[0].amount.toNumber()).toBe(100);
      expect(jasaSpent.toNumber()).toBe(0);
    });

    it('refundForCashOp idempotent when full untagged REFUND_JASA exists', async () => {
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-full',
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
        amount: new Prisma.Decimal(10),
      });
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-full',
        entryType: BudgetLedgerEntryType.REFUND_JASA,
        amount: new Prisma.Decimal(10),
      });
      jasaSpent = new Prisma.Decimal(0);
      const n = ledgerStore.length;
      await service.refundForCashOp('c-full', 'actor', 'again', mockTx as never);
      expect(ledgerStore).toHaveLength(n);
    });

    it('refundForCashOp no-op when partial tagged and full untagged refund already exist', async () => {
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-both',
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
        amount: new Prisma.Decimal(100),
      });
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-both',
        entryType: BudgetLedgerEntryType.REFUND_JASA,
        amount: new Prisma.Decimal(20),
        metadata: { partialRefundType: CashOpPartialRefundType.REALISASI_VARIANCE },
      });
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-both',
        entryType: BudgetLedgerEntryType.REFUND_JASA,
        amount: new Prisma.Decimal(100),
      });
      jasaSpent = new Prisma.Decimal(0);
      const n = ledgerStore.length;
      await service.refundForCashOp('c-both', 'actor', 'x', mockTx as never);
      expect(ledgerStore).toHaveLength(n);
    });
  });

  describe('partialRefundForCashOp', () => {
    beforeEach(() => {
      ledgerStore.push({
        financeProjectId: 'p1',
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: 'c-partial',
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
        amount: new Prisma.Decimal(100),
      });
      jasaSpent = new Prisma.Decimal(100);
      notifications.notifyBudgetThresholdAlerts.mockClear();
    });

    it('rejects amount <= 0', async () => {
      await expect(
        service.partialRefundForCashOp(
          'c-partial',
          new Prisma.Decimal(0),
          'x',
          'actor',
          CashOpPartialRefundType.REALISASI_VARIANCE,
          mockTx as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when no DEDUCT_JASA for cash op', async () => {
      ledgerStore.length = 0;
      await expect(
        service.partialRefundForCashOp(
          'missing',
          new Prisma.Decimal(5),
          'x',
          'actor',
          CashOpPartialRefundType.REALISASI_VARIANCE,
          mockTx as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('happy path → REFUND_JASA row + jasaSpent decrement', async () => {
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(25),
        'Selisih realisasi',
        'gm1',
        CashOpPartialRefundType.REALISASI_VARIANCE,
        mockTx as never,
      );
      const refunds = ledgerStore.filter((r) => r.entryType === BudgetLedgerEntryType.REFUND_JASA);
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount.toNumber()).toBe(25);
      expect(
        (refunds[0].metadata as Record<string, string>).partialRefundType,
      ).toBe(CashOpPartialRefundType.REALISASI_VARIANCE);
      expect(jasaSpent.toNumber()).toBe(75);
    });

    it('idempotent: second call with same tag → no extra row', async () => {
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(25),
        'a',
        'gm1',
        CashOpPartialRefundType.REALISASI_VARIANCE,
        mockTx as never,
      );
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(25),
        'b',
        'gm1',
        CashOpPartialRefundType.REALISASI_VARIANCE,
        mockTx as never,
      );
      const tagged = ledgerStore.filter(
        (r) =>
          r.entryType === BudgetLedgerEntryType.REFUND_JASA &&
          (r.metadata as Record<string, string> | undefined)?.partialRefundType ===
            CashOpPartialRefundType.REALISASI_VARIANCE,
      );
      expect(tagged).toHaveLength(1);
      expect(jasaSpent.toNumber()).toBe(75);
    });

    it('does not call threshold notifications on utilization drop', async () => {
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(10),
        'x',
        'actor',
        CashOpPartialRefundType.REIMBURSEMENT_VARIANCE,
        mockTx as never,
      );
      expect(notifications.notifyBudgetThresholdAlerts).not.toHaveBeenCalled();
    });

    it('P2002 on create → no duplicate increment', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockTx.budgetLedger.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' } as never),
      );
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(10),
        'x',
        'actor',
        CashOpPartialRefundType.REALISASI_VARIANCE,
        mockTx as never,
      );
      expect(ledgerStore.filter((r) => r.entryType === BudgetLedgerEntryType.REFUND_JASA)).toHaveLength(0);
      expect(jasaSpent.toNumber()).toBe(100);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/partialRefundForCashOp: idempotent skip after unique conflict/),
      );
      warnSpy.mockRestore();
    });

    it('REALISASI_VARIANCE and REIMBURSEMENT_VARIANCE on same cash op both post (distinct metadata)', async () => {
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(10),
        'realisasi',
        'gm1',
        CashOpPartialRefundType.REALISASI_VARIANCE,
        mockTx as never,
      );
      await service.partialRefundForCashOp(
        'c-partial',
        new Prisma.Decimal(5),
        'reimb',
        'gm1',
        CashOpPartialRefundType.REIMBURSEMENT_VARIANCE,
        mockTx as never,
      );
      const refunds = ledgerStore.filter((r) => r.entryType === BudgetLedgerEntryType.REFUND_JASA);
      expect(refunds).toHaveLength(2);
      const types = refunds.map(
        (r) => (r.metadata as Record<string, string>).partialRefundType,
      );
      expect(types.sort()).toEqual(
        [CashOpPartialRefundType.REALISASI_VARIANCE, CashOpPartialRefundType.REIMBURSEMENT_VARIANCE].sort(),
      );
      expect(jasaSpent.toNumber()).toBe(85);
    });
  });
});
