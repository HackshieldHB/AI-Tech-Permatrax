import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// NEW: IspCustomerService — GM manages ISP customers used as filter references
@Injectable()
export class IspCustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.ispCustomer.findMany({ orderBy: { name: 'asc' } });
  }

  async findActive() {
    return this.prisma.ispCustomer.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, code: true, contactEmail: true },
    });
  }

  async create(data: { name: string; code: string; contactEmail?: string; logoUrl?: string }, gmId: string) {
    const existing = await this.prisma.ispCustomer.findFirst({
      where: { OR: [{ name: data.name }, { code: data.code }] },
    });
    if (existing) throw new ConflictException('ISP Customer dengan nama atau kode ini sudah ada');
    return this.prisma.ispCustomer.create({ data: { ...data, createdBy: gmId } });
  }

  async update(id: string, data: Partial<{ name: string; code: string; contactEmail: string; isActive: boolean }>) {
    const isp = await this.prisma.ispCustomer.findUnique({ where: { id } });
    if (!isp) throw new NotFoundException('ISP Customer tidak ditemukan');
    return this.prisma.ispCustomer.update({ where: { id }, data });
  }

  async deactivate(id: string) {
    const isp = await this.prisma.ispCustomer.findUnique({ where: { id } });
    if (!isp) throw new NotFoundException('ISP Customer tidak ditemukan');
    return this.prisma.ispCustomer.update({ where: { id }, data: { isActive: false } });
  }
}
