import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/utils/password.util';
import { Role, FiberType, Prisma } from '@prisma/client';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  CreateUserDto,
  UpdateUserDto,
  ChangePasswordDto,
  UserListFilterDto,
  UserFilterDto,
  isFiberRoleType,
} from './user.dto';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';

function assertGmAccountMutable(target: { role: Role }): void {
  if (target.role === Role.GENERAL_MANAGER) {
    throw new ForbiddenException('Akun GM tidak dapat diubah');
  }
}

const safeSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  fiberType: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} as const;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async findAll(filters: UserFilterDto): Promise<PaginatedResponse<unknown>> {
    const { role, fiberType, isActive, search, page, limit, sortBy, sortOrder } = filters;
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = {};

    if (role) where.role = role;
    if (fiberType !== undefined) where.fiberType = fiberType;
    if (isActive !== undefined) where.isActive = isActive;
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { email: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const orderField = sortBy && ['createdAt', 'name', 'email', 'role'].includes(sortBy) ? sortBy : 'createdAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.UserOrderByWithRelationInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          ...safeSelect,
          creator: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...safeSelect,
        creator: { select: { id: true, name: true, email: true } },
      },
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: safeSelect,
    });
  }

  async create(dto: CreateUserDto, createdByGmId: string) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email sudah terdaftar');

    let fiber: FiberType | null = dto.fiberType ?? null;
    if (isFiberRoleType(dto.role) && !fiber) {
      throw new BadRequestException('Fiber type wajib untuk role PM/Surveyor');
    }
    if (!isFiberRoleType(dto.role)) fiber = null;

    const password = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password,
        role: dto.role,
        fiberType: fiber,
        createdBy: createdByGmId,
      },
      select: safeSelect,
    });

    this.gateway.emitToRoom('role:GENERAL_MANAGER', 'user:created', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, gmId: string) {
    const current = await this.prisma.user.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('User tidak ditemukan');
    assertGmAccountMutable(current);

    if (id === gmId && dto.role !== undefined && dto.role !== current.role) {
      throw new ForbiddenException('Tidak dapat mengubah role diri sendiri');
    }
    if (id === gmId && dto.isActive === false) {
      throw new ForbiddenException('Tidak dapat menonaktifkan akun sendiri');
    }

    const nextRole = dto.role ?? current.role;
    let nextFiber: FiberType | null = current.fiberType;
    if (dto.fiberType !== undefined) nextFiber = dto.fiberType;
    if (dto.role !== undefined && !isFiberRoleType(nextRole)) nextFiber = null;
    if (isFiberRoleType(nextRole) && !nextFiber) {
      throw new BadRequestException('Fiber type wajib untuk role PM/Surveyor');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    data.fiberType = isFiberRoleType(nextRole) ? nextFiber : null;

    const roleChanged = dto.role !== undefined && dto.role !== current.role;

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: safeSelect,
    });

    if (dto.isActive === false || roleChanged) {
      await this.prisma.user.update({
        where: { id },
        data: { refreshToken: null },
      });
    }

    if (roleChanged) {
      this.gateway.emitToRoom(`user:${id}`, 'user:roleChanged', {
        userId: id,
        newRole: updated.role,
      });
    }

    return updated;
  }

  async changePassword(userId: string, dto: ChangePasswordDto, _gmId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    assertGmAccountMutable(target);
    const hash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hash, refreshToken: null },
    });
    return { success: true, message: 'Password berhasil diubah' };
  }

  async deactivate(id: string, gmId: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    assertGmAccountMutable(target);
    if (id === gmId) throw new ForbiddenException('Tidak dapat menonaktifkan diri sendiri');
    await this.prisma.user.update({
      where: { id },
      data: { isActive: false, refreshToken: null },
    });
    return { success: true };
  }

  async reactivate(id: string, _gmId: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    assertGmAccountMutable(target);
    await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
    });
    return { success: true };
  }

  async getUserStats() {
    const [total, active, inactive, grouped, recentlyCreated] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: false } }),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: safeSelect,
      }),
    ]);

    return {
      total,
      active,
      inactive,
      byRole: grouped.map((g) => ({
        role: g.role,
        count: g._count._all,
        label: g.role.replace(/_/g, ' '),
      })),
      recentlyCreated,
    };
  }
}
