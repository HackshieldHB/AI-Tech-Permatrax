import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type { CreateSupplierDtoType, FilterSupplierDtoType, UpdateSupplierDtoType } from './supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async generateCode(): Promise<string> {
    const year = new Date().getFullYear();
    const lastSupplier = await this.prisma.supplier.findFirst({
      where: { code: { startsWith: `SUP-${year}-` } },
      orderBy: { code: 'desc' },
    });

    const lastSeq = lastSupplier ? parseInt(lastSupplier.code.split('-')[2] || '0', 10) : 0;
    const newSeq = (lastSeq + 1).toString().padStart(3, '0');
    return `SUP-${year}-${newSeq}`;
  }

  async create(dto: CreateSupplierDtoType, createdById: string): Promise<Supplier> {
    const code = await this.generateCode();
    return this.prisma.supplier.create({
      data: {
        code,
        name: dto.name,
        npwp: dto.npwp,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        bankAccount: dto.bankAccount,
        bankName: dto.bankName,
        contactPerson: dto.contactPerson,
        notes: dto.notes,
        createdById,
      },
    });
  }

  async update(id: string, dto: UpdateSupplierDtoType): Promise<Supplier> {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier tidak ditemukan');
    return this.prisma.supplier.update({
      where: { id },
      data: dto,
    });
  }

  async findAll(filter: FilterSupplierDtoType): Promise<PaginatedResponse<Supplier>> {
    const where: Prisma.SupplierWhereInput = {};

    if (filter.isActive === 'true') where.isActive = true;
    else if (filter.isActive === 'false') where.isActive = false;

    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { npwp: { contains: q } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findOne(id: string): Promise<Supplier> {
    const row = await this.prisma.supplier.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Supplier tidak ditemukan');
    return row;
  }

  async findActive(): Promise<Supplier[]> {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async deactivate(id: string): Promise<Supplier> {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async activate(id: string): Promise<Supplier> {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: true },
    });
  }
}
