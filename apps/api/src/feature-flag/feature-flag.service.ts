import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { UpdateFeatureFlagDto } from './feature-flag.dto';

@Injectable()
export class FeatureFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async findAll() {
    return this.prisma.featureFlag.findMany({
      orderBy: { featureKey: 'asc' },
      include: { updater: { select: { id: true, name: true, email: true } } },
    });
  }

  async update(featureKey: string, dto: UpdateFeatureFlagDto, gmId: string) {
    const row = await this.prisma.featureFlag.findUnique({ where: { featureKey } });
    if (!row) throw new NotFoundException('Feature flag tidak ditemukan');

    const updated = await this.prisma.featureFlag.update({
      where: { featureKey },
      data: {
        roles: dto.roles,
        isEnabled: dto.isEnabled,
        updatedBy: gmId,
      },
      include: { updater: { select: { id: true, name: true, email: true } } },
    });

    this.gateway.emitToAll('featureFlag:updated', { featureKey, isEnabled: dto.isEnabled });
    return updated;
  }

  async checkAccessAsync(featureKey: string, userRole: Role): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { featureKey } });
    if (!flag || !flag.isEnabled) return false;
    return flag.roles.includes(userRole);
  }

  async getMyAccess(userRole: Role) {
    const flags = await this.prisma.featureFlag.findMany({
      where: { isEnabled: true },
    });
    const features = flags // FIX: only keys where current role is allowed
      .filter((f) => (f.roles as Role[]).includes(userRole))
      .map((f) => f.featureKey);
    return { features }; // FIX: stable shape for frontend + socket consumers
  }
}
