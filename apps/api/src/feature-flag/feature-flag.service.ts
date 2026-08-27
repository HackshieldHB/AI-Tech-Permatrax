import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { UpdateFeatureFlagDto } from './feature-flag.dto';

/** Sidebar/API roles that must keep GIS + Pipeline even if Settings.roles was narrowed (prod). */
const CORE_OPS_FEATURE_ROLES: Record<string, Role[]> = {
  GIS_MAP: [
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.DESIGNER,
    Role.OPERATIONAL_MANAGER,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
    Role.MAP_VIEWER,
  ],
  PERMIT_PIPELINE: [
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.DESIGNER,
    Role.OPERATIONAL_MANAGER,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
  ],
};

function hasCoreOpsGrant(featureKey: string, userRole: Role): boolean {
  return (CORE_OPS_FEATURE_ROLES[featureKey] ?? []).includes(userRole);
}

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
    if (hasCoreOpsGrant(featureKey, userRole)) return true;
    const flag = await this.prisma.featureFlag.findUnique({ where: { featureKey } });
    if (!flag || !flag.isEnabled) return false;
    return flag.roles.includes(userRole);
  }

  async getMyAccess(userRole: Role) {
    const flags = await this.prisma.featureFlag.findMany({
      where: { isEnabled: true },
    });
    const features = flags
      .filter((f) => (f.roles as Role[]).includes(userRole))
      .map((f) => f.featureKey);
    for (const key of Object.keys(CORE_OPS_FEATURE_ROLES)) {
      if (hasCoreOpsGrant(key, userRole) && !features.includes(key)) {
        features.push(key);
      }
    }
    return { features };
  }
}
