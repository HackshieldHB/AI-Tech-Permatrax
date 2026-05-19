import { Injectable, NotFoundException } from '@nestjs/common';
import { BudgetLedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';

export interface ForecastDto {
  burnRate: { material: number; jasa: number };
  estimatedDepletionDate: { material: Date | null; jasa: Date | null };
  projectedFinalRealization: { material: number; jasa: number; total: number };
  projectionWindow: {
    type: 'endDate' | 'fallback30days';
    endDate: Date | null;
    daysProjected: number;
  };
  metadata: {
    daysSinceStart: number;
    transactionCount: number;
    isReliable: boolean;
    disclaimer: string;
  };
}

@Injectable()
export class FinanceForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetLedger: BudgetLedgerService,
  ) {}

  async getForecast(projectId: string): Promise<ForecastDto> {
    const project = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Finance project tidak ditemukan');

    const startDate = project.createdAt;
    const now = new Date();
    const msPerDay = 86400000;
    const daysSinceStart = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / msPerDay));

    const last30Days = new Date(now.getTime() - 30 * msPerDay);
    const windowStart = last30Days > startDate ? last30Days : startDate;

    const deductions = await this.prisma.budgetLedger.findMany({
      where: {
        financeProjectId: projectId,
        entryType: {
          in: [BudgetLedgerEntryType.DEDUCT_MATERIAL, BudgetLedgerEntryType.DEDUCT_JASA],
        },
        createdAt: { gte: windowStart },
      },
    });

    const materialDeducts = deductions.filter((d) => d.entryType === BudgetLedgerEntryType.DEDUCT_MATERIAL);
    const jasaDeducts = deductions.filter((d) => d.entryType === BudgetLedgerEntryType.DEDUCT_JASA);

    const sumDec = (rows: typeof deductions): Prisma.Decimal =>
      rows.reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0));

    const periodDays = Math.min(30, daysSinceStart);
    const denom = Math.max(1, periodDays);
    const burnRateMaterial = sumDec(materialDeducts).div(denom).toNumber();
    const burnRateJasa = sumDec(jasaDeducts).div(denom).toNumber();

    const remainingMaterial = this.budgetLedger.getMaterialRemaining(project).toNumber();
    const remainingJasa = this.budgetLedger.getJasaRemaining(project).toNumber();

    const depletionFor = (remaining: number, burn: number): Date | null => {
      if (burn <= 0) return null;
      if (remaining <= 0) return new Date(now.getTime());
      const estDays = remaining / burn;
      return new Date(now.getTime() + estDays * msPerDay);
    };

    const materialSpentN = new Prisma.Decimal(project.materialSpent).toNumber();
    const jasaSpentN = new Prisma.Decimal(project.jasaSpent).toNumber();

    const lookaheadDays = 30;
    let projectedMaterial: number;
    let projectedJasa: number;
    let projectionWindow: ForecastDto['projectionWindow'];

    const endDateVal = project.endDate;
    if (endDateVal != null && endDateVal.getTime() > now.getTime()) {
      const daysToEndDate = (endDateVal.getTime() - now.getTime()) / msPerDay;
      projectedMaterial = materialSpentN + burnRateMaterial * daysToEndDate;
      projectedJasa = jasaSpentN + burnRateJasa * daysToEndDate;
      projectionWindow = {
        type: 'endDate',
        endDate: endDateVal,
        daysProjected: daysToEndDate,
      };
    } else {
      projectedMaterial = materialSpentN + burnRateMaterial * lookaheadDays;
      projectedJasa = jasaSpentN + burnRateJasa * lookaheadDays;
      projectionWindow = {
        type: 'fallback30days',
        endDate: endDateVal ?? null,
        daysProjected: lookaheadDays,
      };
    }

    const isReliable = daysSinceStart >= 7 && deductions.length >= 5;
    const disclaimer = isReliable
      ? 'Estimasi berdasarkan data 30 hari terakhir.'
      : 'Data belum cukup untuk estimasi reliable. Minimal 7 hari operasi dan 5 transaksi.';

    return {
      burnRate: { material: burnRateMaterial, jasa: burnRateJasa },
      estimatedDepletionDate: {
        material: depletionFor(remainingMaterial, burnRateMaterial),
        jasa: depletionFor(remainingJasa, burnRateJasa),
      },
      projectedFinalRealization: {
        material: projectedMaterial,
        jasa: projectedJasa,
        total: projectedMaterial + projectedJasa,
      },
      projectionWindow,
      metadata: {
        daysSinceStart,
        transactionCount: deductions.length,
        isReliable,
        disclaimer,
      },
    };
  }
}
