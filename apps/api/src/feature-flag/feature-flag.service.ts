import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { UpdateFeatureFlagDto } from './feature-flag.dto';
import {
  CORE_OPS_FEATURE_ROLES,
  hasCoreOpsGrant,
  unionDefaultRoles,
  withGuaranteedGm,
} from './feature-flag.defaults';

@Injectable()
export class FeatureFlagService implements OnModuleInit {
  private readonly log = new Logger(FeatureFlagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async onModuleInit() {
    await this.healFlagGrants();
  }

  /** Restore GM + seed/core-ops roles without stripping extra grants. */
  async healFlagGrants() {
    const flags = await this.prisma.featureFlag.findMany();
    for (const flag of flags) {
      const roles = unionDefaultRoles(flag.featureKey, flag.roles as string[]);
      const same =
        roles.length === flag.roles.length &&
        roles.every((r) => flag.roles.includes(r));
      if (same) continue;
      await this.prisma.featureFlag.update({
        where: { featureKey: flag.featureKey },
        data: { roles },
      });
      this.log.log(`Healed feature flag roles: ${flag.featureKey}`);
    }
  }

  async findAll() {
    return this.prisma.featureFlag.findMany({
      orderBy: { featureKey: 'asc' },
      include: { updater: { select: { id: true, name: true, email: true } } },
    });
  }

  async update(featureKey: string, dto: UpdateFeatureFlagDto, gmId: string) {
    const row = await this.prisma.featureFlag.findUnique({ where: { featureKey } });
    if (!row) throw new NotFoundException('Feature flag tidak ditemukan');

    const roles = withGuaranteedGm(dto.roles);
    const updated = await this.prisma.featureFlag.update({
      where: { featureKey },
      data: {
        roles,
        isEnabled: dto.isEnabled,
        updatedBy: gmId,
      },
      include: { updater: { select: { id: true, name: true, email: true } } },
    });

    this.gateway.emitToAll('featureFlag:updated', { featureKey, isEnabled: dto.isEnabled });
    return updated;
  }

  async checkAccessAsync(featureKey: string, userRole: Role): Promise<boolean> {
    if (userRole === Role.GENERAL_MANAGER) return true;
    if (hasCoreOpsGrant(featureKey, userRole)) return true;
    const flag = await this.prisma.featureFlag.findUnique({ where: { featureKey } });
    if (!flag || !flag.isEnabled) return false;
    return flag.roles.includes(userRole);
  }

  async getMyAccess(userRole: Role) {
    const flags = await this.prisma.featureFlag.findMany();
    if (userRole === Role.GENERAL_MANAGER) {
      return { features: flags.map((f) => f.featureKey) };
    }
    const features = flags
      .filter((f) => f.isEnabled && (f.roles as Role[]).includes(userRole))
      .map((f) => f.featureKey);
    for (const key of Object.keys(CORE_OPS_FEATURE_ROLES)) {
      if (hasCoreOpsGrant(key, userRole) && !features.includes(key)) {
        features.push(key);
      }
    }
    return { features };
  }
}
