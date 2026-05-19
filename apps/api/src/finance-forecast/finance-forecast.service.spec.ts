import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BudgetLedgerEntryType, Prisma } from '@prisma/client';
import { FinanceForecastService } from './finance-forecast.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';

describe('FinanceForecastService', () => {
  let service: FinanceForecastService;

  const prisma = {
    financeProject: { findUnique: jest.fn() },
    budgetLedger: { findMany: jest.fn() },
  };

  const ledger = {
    getMaterialRemaining: jest.fn().mockReturnValue(new Prisma.Decimal(100)),
    getJasaRemaining: jest.fn().mockReturnValue(new Prisma.Decimal(50)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceForecastService,
        { provide: PrismaService, useValue: prisma },
        { provide: BudgetLedgerService, useValue: ledger },
      ],
    }).compile();
    service = module.get(FinanceForecastService);
  });

  it('throws when project missing', async () => {
    prisma.financeProject.findUnique.mockResolvedValue(null);
    await expect(service.getForecast('p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('projectionWindow: endDate masa depan → type endDate', async () => {
    const created = new Date();
    created.setDate(created.getDate() - 10);
    const end = new Date();
    end.setDate(end.getDate() + 20);
    prisma.financeProject.findUnique.mockResolvedValue({
      id: 'p1',
      createdAt: created,
      endDate: end,
      materialSpent: new Prisma.Decimal(100),
      jasaSpent: new Prisma.Decimal(50),
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(600),
      jasaBudget: new Prisma.Decimal(400),
    });
    prisma.budgetLedger.findMany.mockResolvedValue([
      { entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL, amount: new Prisma.Decimal(60) },
      { entryType: BudgetLedgerEntryType.DEDUCT_JASA, amount: new Prisma.Decimal(30) },
    ]);
    const f = await service.getForecast('p1');
    expect(f.projectionWindow.type).toBe('endDate');
    expect(f.projectionWindow.endDate).toEqual(end);
    expect(f.projectionWindow.daysProjected).toBeGreaterThan(0);
    expect(f.projectedFinalRealization.material).toBeGreaterThan(100);
  });

  it('projectionWindow: endDate lampau → fallback 30 hari', async () => {
    const created = new Date();
    created.setDate(created.getDate() - 30);
    const endPast = new Date();
    endPast.setDate(endPast.getDate() - 5);
    prisma.financeProject.findUnique.mockResolvedValue({
      id: 'p1',
      createdAt: created,
      endDate: endPast,
      materialSpent: new Prisma.Decimal(200),
      jasaSpent: new Prisma.Decimal(0),
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(600),
      jasaBudget: new Prisma.Decimal(400),
    });
    prisma.budgetLedger.findMany.mockResolvedValue([]);
    const f = await service.getForecast('p1');
    expect(f.projectionWindow.type).toBe('fallback30days');
    expect(f.projectionWindow.daysProjected).toBe(30);
    expect(f.projectionWindow.endDate).toEqual(endPast);
  });

  it('projectionWindow: endDate null → fallback 30 hari', async () => {
    const created = new Date();
    created.setDate(created.getDate() - 14);
    prisma.financeProject.findUnique.mockResolvedValue({
      id: 'p1',
      createdAt: created,
      endDate: null,
      materialSpent: new Prisma.Decimal(10),
      jasaSpent: new Prisma.Decimal(5),
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(600),
      jasaBudget: new Prisma.Decimal(400),
    });
    prisma.budgetLedger.findMany.mockResolvedValue([]);
    const f = await service.getForecast('p1');
    expect(f.projectionWindow.type).toBe('fallback30days');
    expect(f.projectionWindow.endDate).toBeNull();
    expect(f.projectionWindow.daysProjected).toBe(30);
  });

  it('no deductions → burn 0, not reliable', async () => {
    const created = new Date();
    created.setDate(created.getDate() - 3);
    prisma.financeProject.findUnique.mockResolvedValue({
      id: 'p1',
      createdAt: created,
      materialSpent: new Prisma.Decimal(0),
      jasaSpent: new Prisma.Decimal(0),
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(600),
      jasaBudget: new Prisma.Decimal(400),
    });
    prisma.budgetLedger.findMany.mockResolvedValue([]);
    const f = await service.getForecast('p1');
    expect(f.burnRate.material).toBe(0);
    expect(f.burnRate.jasa).toBe(0);
    expect(f.metadata.isReliable).toBe(false);
    expect(f.estimatedDepletionDate.material).toBeNull();
  });

  it('burnRate > 0 but remaining ≤0 → depletion ~ now', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 30);
    prisma.financeProject.findUnique.mockResolvedValue({
      id: 'p1',
      createdAt: old,
      endDate: null,
      materialSpent: new Prisma.Decimal(500),
      jasaSpent: new Prisma.Decimal(0),
      totalBudget: new Prisma.Decimal(1000),
      materialBudget: new Prisma.Decimal(500),
      jasaBudget: new Prisma.Decimal(500),
    });
    ledger.getMaterialRemaining.mockReturnValue(new Prisma.Decimal(-10));
    prisma.budgetLedger.findMany.mockResolvedValue([
      {
        entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
        amount: new Prisma.Decimal(300),
      },
    ]);
    const f = await service.getForecast('p1');
    expect(f.burnRate.material).toBeGreaterThan(0);
    expect(f.estimatedDepletionDate.material).not.toBeNull();
  });
});
