import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceProjectStatus, Prisma } from '@prisma/client';
import { FinanceReportService } from './finance-report.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';

describe('FinanceReportService', () => {
  let service: FinanceReportService;

  const project = {
    id: 'p1',
    code: 'FIN-1',
    name: 'P',
    status: FinanceProjectStatus.ACTIVE,
    totalBudget: new Prisma.Decimal(1000),
    materialBudget: new Prisma.Decimal(600),
    jasaBudget: new Prisma.Decimal(400),
    materialSpent: new Prisma.Decimal(100),
    jasaSpent: new Prisma.Decimal(50),
  };

  const prisma = {
    financeProject: { findMany: jest.fn(), findUnique: jest.fn() },
    budgetLedger: { findMany: jest.fn() },
    budgetTransfer: { findMany: jest.fn() },
  };

  const ledger = {
    getMaterialCap: jest.fn().mockReturnValue(new Prisma.Decimal(600)),
    getJasaCap: jest.fn().mockReturnValue(new Prisma.Decimal(400)),
    getMaterialRemaining: jest.fn().mockReturnValue(new Prisma.Decimal(500)),
    getJasaRemaining: jest.fn().mockReturnValue(new Prisma.Decimal(350)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReportService,
        { provide: PrismaService, useValue: prisma },
        { provide: BudgetLedgerService, useValue: ledger },
      ],
    }).compile();
    service = module.get(FinanceReportService);
  });

  it('exportProjectExcel has Summary, Ledger, Adjustments sheets and project name', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs');
    prisma.financeProject.findUnique.mockResolvedValue(project);
    prisma.budgetLedger.findMany.mockResolvedValue([]);
    const buf = await service.exportProjectExcel('p1');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    expect(workbook.worksheets.length).toBe(3);
    expect(workbook.getWorksheet('Summary')).toBeDefined();
    expect(workbook.getWorksheet('Ledger')).toBeDefined();
    expect(workbook.getWorksheet('Adjustments')).toBeDefined();
    const summary = workbook.getWorksheet('Summary')!;
    const values: string[] = [];
    summary.eachRow((row: any) => {
      row.eachCell((cell: any) => {
        if (cell.value != null) values.push(String(cell.value));
      });
    });
    expect(values.some((v) => v.includes(project.name))).toBe(true);
  });

  it('exportProjectExcel returns non-empty buffer', async () => {
    prisma.financeProject.findUnique.mockResolvedValue(project);
    prisma.budgetLedger.findMany.mockResolvedValue([]);
    const buf = await service.exportProjectExcel('p1');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('exportProjectPdf returns valid PDF buffer', async () => {
    prisma.financeProject.findUnique.mockResolvedValue(project);
    prisma.budgetLedger.findMany.mockResolvedValue([]);
    const buf = await service.exportProjectPdf('p1');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(200);
  });

  it('exportSummaryExcel returns buffer', async () => {
    prisma.financeProject.findMany.mockResolvedValue([project]);
    prisma.budgetTransfer.findMany.mockResolvedValue([]);
    const buf = await service.exportSummaryExcel();
    expect(buf.length).toBeGreaterThan(100);
  });

  it('exportProjectExcel missing project → 404', async () => {
    prisma.financeProject.findUnique.mockResolvedValue(null);
    await expect(service.exportProjectExcel('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
