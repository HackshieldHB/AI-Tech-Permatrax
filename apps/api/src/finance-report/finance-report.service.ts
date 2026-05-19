import { Injectable, NotFoundException } from '@nestjs/common';
// exceljs / pdfkit: CommonJS — hindari default import di Jest/TS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import {
  BudgetLedgerEntryType,
  BudgetTransferStatus,
  FinanceProjectStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';

export type ReportDateFilter = { from?: Date; to?: Date };

@Injectable()
export class FinanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BudgetLedgerService,
  ) {}

  private ledgerPeriodWhere(
    projectId: string,
    filter?: ReportDateFilter,
  ): Prisma.BudgetLedgerWhereInput {
    return {
      financeProjectId: projectId,
      ...(filter?.from || filter?.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };
  }

  private async ensureProject(projectId: string) {
    const project = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Finance project tidak ditemukan');
    return project;
  }

  private formatPeriod(filter?: ReportDateFilter): string {
    if (!filter?.from && !filter?.to) return 'Sepanjang waktu';
    const f = filter.from ? filter.from.toISOString().slice(0, 10) : '…';
    const t = filter.to ? filter.to.toISOString().slice(0, 10) : '…';
    return `${f} – ${t}`;
  }

  async exportProjectExcel(projectId: string, filter?: ReportDateFilter): Promise<Buffer> {
    const project = await this.ensureProject(projectId);
    const matCap = this.ledger.getMaterialCap(project).toNumber();
    const jasCap = this.ledger.getJasaCap(project).toNumber();
    const matRem = this.ledger.getMaterialRemaining(project).toNumber();
    const jasRem = this.ledger.getJasaRemaining(project).toNumber();

    const [ledgerRows, adjRows] = await Promise.all([
      this.prisma.budgetLedger.findMany({
        where: this.ledgerPeriodWhere(projectId, filter),
        orderBy: { createdAt: 'asc' },
        include: { createdBy: { select: { name: true, email: true } } },
      }),
      this.prisma.budgetLedger.findMany({
        where: {
          financeProjectId: projectId,
          entryType: {
            in: [BudgetLedgerEntryType.BUDGET_INIT, BudgetLedgerEntryType.BUDGET_ADJUSTMENT],
          },
          ...(filter?.from || filter?.to
            ? {
                createdAt: {
                  ...(filter.from ? { gte: filter.from } : {}),
                  ...(filter.to ? { lte: filter.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
        include: { createdBy: { select: { name: true, email: true } } },
      }),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PermaTrack Finance';
    const sum = wb.addWorksheet('Summary');
    sum.addRow(['Laporan proyek keuangan']);
    sum.addRow(['Kode', project.code]);
    sum.addRow(['Nama', project.name]);
    sum.addRow(['Periode', this.formatPeriod(filter)]);
    sum.addRow(['Total budget', project.totalBudget.toString()]);
    sum.addRow(['Alokasi material', project.materialBudget?.toString() ?? '(implisit)']);
    sum.addRow(['Alokasi jasa', project.jasaBudget?.toString() ?? '(implisit)']);
    sum.addRow(['Plafon material (efektif)', matCap]);
    sum.addRow(['Plafon jasa (efektif)', jasCap]);
    sum.addRow(['Realisasi material', project.materialSpent.toString()]);
    sum.addRow(['Realisasi jasa', project.jasaSpent.toString()]);
    sum.addRow(['Sisa material', matRem]);
    sum.addRow(['Sisa jasa', jasRem]);
    sum.addRow(['Status', project.status]);
    sum.addRow(['Utilisasi material', matCap > 0 ? (project.materialSpent.toNumber() / matCap) * 100 : 0]);
    sum.addRow(['Utilisasi jasa', jasCap > 0 ? (project.jasaSpent.toNumber() / jasCap) * 100 : 0]);

    const led = wb.addWorksheet('Ledger');
    led.addRow([
      'Waktu',
      'Tipe',
      'Kategori',
      'Jumlah',
      'Sumber',
      'Ref',
      'Catatan',
      'Dibuat oleh',
    ]);
    for (const r of ledgerRows) {
      led.addRow([
        r.createdAt.toISOString(),
        r.entryType,
        r.category ?? '',
        r.amount.toString(),
        r.sourceType ?? '',
        r.sourceId ?? '',
        r.notes ?? '',
        r.createdBy?.name ?? r.createdBy?.email ?? '',
      ]);
    }

    const adj = wb.addWorksheet('Adjustments');
    adj.addRow(['Waktu', 'Tipe', 'Jumlah', 'Catatan', 'Metadata', 'Dibuat oleh']);
    for (const r of adjRows) {
      adj.addRow([
        r.createdAt.toISOString(),
        r.entryType,
        r.amount.toString(),
        r.notes ?? '',
        r.metadata ? JSON.stringify(r.metadata) : '',
        r.createdBy?.name ?? r.createdBy?.email ?? '',
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async exportProjectPdf(projectId: string, filter?: ReportDateFilter): Promise<Buffer> {
    const project = await this.ensureProject(projectId);
    const matCap = this.ledger.getMaterialCap(project);
    const jasCap = this.ledger.getJasaCap(project);
    const uMat =
      matCap.gt(0) ? project.materialSpent.div(matCap).mul(100).toNumber() : 0;
    const uJas = jasCap.gt(0) ? project.jasaSpent.div(jasCap).mul(100).toNumber() : 0;

    const recent = await this.prisma.budgetLedger.findMany({
      where: this.ledgerPeriodWhere(projectId, filter),
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { name: true } } },
    });

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(16).text(`${project.name} (${project.code})`, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Periode: ${this.formatPeriod(filter)}`);
    doc.moveDown();

    doc.fontSize(12).text('Ringkasan', { underline: true });
    doc.fontSize(10);
    doc.text(`Total budget: ${project.totalBudget.toString()} IDR`);
    doc.text(`Material dialokasikan: ${project.materialBudget?.toString() ?? '—'}`);
    doc.text(`Jasa dialokasikan: ${project.jasaBudget?.toString() ?? '—'}`);
    doc.text(`Realisasi material: ${project.materialSpent.toString()} IDR`);
    doc.text(`Realisasi jasa: ${project.jasaSpent.toString()} IDR`);
    doc.text(`Sisa material: ${this.ledger.getMaterialRemaining(project).toString()} IDR`);
    doc.text(`Sisa jasa: ${this.ledger.getJasaRemaining(project).toString()} IDR`);
    doc.text(`Utilisasi material: ${uMat.toFixed(1)}%`);
    doc.text(`Utilisasi jasa: ${uJas.toFixed(1)}%`);
    doc.moveDown();

    doc.fontSize(12).text('50 entri ledger terbaru', { underline: true });
    doc.fontSize(8);
    for (const r of recent) {
      doc.text(
        `${r.createdAt.toISOString().slice(0, 19)} | ${r.entryType} | ${r.amount.toString()} | ${r.notes ?? ''} | ${r.createdBy?.name ?? ''}`,
      );
    }
    doc.moveDown();
    doc.fontSize(8).text(`Di-generate: ${new Date().toISOString()}`, { align: 'right' });

    doc.end();
    return done;
  }

  async exportSummaryExcel(filter?: ReportDateFilter): Promise<Buffer> {
    const projects = await this.prisma.financeProject.findMany({
      where: { status: { not: FinanceProjectStatus.ARCHIVED } },
      orderBy: { code: 'asc' },
    });

    const pending = await this.prisma.budgetTransfer.findMany({
      where: { status: BudgetTransferStatus.PENDING_GM_APPROVAL },
      include: {
        sourceProject: { select: { code: true, name: true } },
        targetProject: { select: { code: true, name: true } },
        submittedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet('All Projects');
    sh.addRow([
      'Kode',
      'Nama',
      'Status',
      'Total budget',
      'Realisasi material',
      'Realisasi jasa',
      'Sisa material',
      'Sisa jasa',
      'Util material %',
      'Util jasa %',
      'Periode laporan',
    ]);
    for (const p of projects) {
      const mc = this.ledger.getMaterialCap(p);
      const jc = this.ledger.getJasaCap(p);
      const um = mc.gt(0) ? p.materialSpent.div(mc).mul(100).toNumber() : 0;
      const uj = jc.gt(0) ? p.jasaSpent.div(jc).mul(100).toNumber() : 0;
      sh.addRow([
        p.code,
        p.name,
        p.status,
        p.totalBudget.toNumber(),
        p.materialSpent.toNumber(),
        p.jasaSpent.toNumber(),
        this.ledger.getMaterialRemaining(p).toNumber(),
        this.ledger.getJasaRemaining(p).toNumber(),
        um,
        uj,
        this.formatPeriod(filter),
      ]);
    }

    const pt = wb.addWorksheet('Pending Transfers');
    pt.addRow(['Dibuat', 'Dari', 'Ke', 'Kategori', 'Jumlah', 'Pengaju', 'Alasan']);
    for (const t of pending) {
      pt.addRow([
        t.createdAt.toISOString(),
        t.sourceProject.code,
        t.targetProject.code,
        `${t.sourceCategory}→${t.targetCategory}`,
        t.amount.toString(),
        t.submittedBy.name ?? t.submittedBy.email ?? t.submittedById,
        t.reason,
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async exportSummaryPdf(filter?: ReportDateFilter): Promise<Buffer> {
    const projects = await this.prisma.financeProject.findMany({
      where: { status: { not: FinanceProjectStatus.ARCHIVED } },
      orderBy: { code: 'asc' },
    });

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(16).text('Ringkasan semua proyek keuangan', { underline: true });
    doc.fontSize(10).text(`Periode: ${this.formatPeriod(filter)}`);
    doc.moveDown();
    doc.fontSize(10);
    for (const p of projects) {
      const mc = this.ledger.getMaterialCap(p);
      const jc = this.ledger.getJasaCap(p);
      const um = mc.gt(0) ? p.materialSpent.div(mc).mul(100).toNumber() : 0;
      const uj = jc.gt(0) ? p.jasaSpent.div(jc).mul(100).toNumber() : 0;
      doc.text(
        `${p.code} | ${p.name} | util M ${um.toFixed(0)}% J ${uj.toFixed(0)}% | sisa M ${this.ledger.getMaterialRemaining(p).toNumber().toFixed(0)} J ${this.ledger.getJasaRemaining(p).toNumber().toFixed(0)}`,
      );
    }
    doc.moveDown();
    doc.fontSize(8).text(`Di-generate: ${new Date().toISOString()}`, { align: 'right' });
    doc.end();
    return done;
  }
}
