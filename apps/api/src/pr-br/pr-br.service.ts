import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { PrBrType } from '@prisma/client';

@Injectable()
export class PrBrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async findAll(permitClusterId: string) {
    return this.prisma.prBrRecord.findMany({
      where: { permitClusterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async nextDoc(prefix: string) {
    const year = new Date().getFullYear();
    const n = await this.prisma.prBrRecord.count({
      where: { documentNumber: { startsWith: `${prefix}-${year}` } },
    });
    return `${prefix}-${year}-${String(n + 1).padStart(4, '0')}`;
  }

  async createPr(
    permitClusterId: string,
    dto: { amount: string; description: string; fileUrl?: string },
    userId: string,
  ) {
    const documentNumber = await this.nextDoc('PR');
    const row = await this.prisma.prBrRecord.create({
      data: {
        permitClusterId,
        type: 'PR' as PrBrType,
        documentNumber,
        amount: new Prisma.Decimal(dto.amount),
        description: dto.description,
        fileUrl: dto.fileUrl,
        createdBy: userId,
      },
    });
    await this.permitCluster.advancePhaseInternal(permitClusterId, 'PR_BR_ISSUANCE');
    return row;
  }

  async createBr(
    permitClusterId: string,
    dto: { amount: string; description: string; fileUrl?: string },
    userId: string,
  ) {
    const documentNumber = await this.nextDoc('BR');
    const row = await this.prisma.prBrRecord.create({
      data: {
        permitClusterId,
        type: 'BR' as PrBrType,
        documentNumber,
        amount: new Prisma.Decimal(dto.amount),
        description: dto.description,
        fileUrl: dto.fileUrl,
        createdBy: userId,
      },
    });
    await this.permitCluster.advancePhaseInternal(permitClusterId, 'PR_BR_ISSUANCE');
    return row;
  }

  async markIssued(id: string, userId: string) {
    const row = await this.prisma.prBrRecord.findUnique({
      where: { id },
      include: { permitCluster: true },
    });
    if (!row) throw new NotFoundException('Record tidak ada');
    void userId;
    const updated = await this.prisma.prBrRecord.update({
      where: { id },
      data: { status: 'ISSUED', issuedAt: new Date() },
    });

    const types = await this.prisma.prBrRecord.groupBy({
      by: ['type'],
      where: { permitClusterId: row.permitClusterId, status: 'ISSUED' },
      _count: true,
    });
    const hasPr = types.some((t) => t.type === 'PR');
    const hasBr = types.some((t) => t.type === 'BR');
    if (hasPr && hasBr) {
      await this.permitCluster.advancePhaseInternal(row.permitClusterId, 'CONTRACT_MANAGEMENT');
    }

    return updated;
  }
}
