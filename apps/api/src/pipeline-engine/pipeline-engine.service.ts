import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FiberType,
  PermitClusterStatus,
  Prisma,
  Role,
  StageProgressStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePipelineTemplateDto } from './dto/create-template.dto';

@Injectable()
export class PipelineEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * METHOD 1: getTemplate
   * Find active template for fiberType + ispCustomerId combination.
   */
  async getTemplate(fiberType: FiberType, ispCustomerId: string) {
    const template = await this.prisma.pipelineTemplate.findFirst({
      where: {
        fiberType,
        ispCustomerId,
        isActive: true,
      },
      orderBy: { version: 'desc' },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });

    if (!template) {
      throw new NotFoundException(
        `No active template found for ${fiberType} and customer ${ispCustomerId}`,
      );
    }

    return template;
  }

  /**
   * METHOD 2: initializeClusterPipeline
   * Called when a new PermitCluster is created with a templateId.
   */
  async initializeClusterPipeline(clusterId: string, templateId: string) {
    const template = await this.prisma.pipelineTemplate.findUnique({
      where: { id: templateId },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });

    if (!template) throw new NotFoundException('Template not found');

    const progressData = template.stages.map((stage) => ({
      clusterId,
      stageId: stage.id,
      status:
        stage.sequence === 1
          ? StageProgressStatus.ACTIVE
          : StageProgressStatus.LOCKED,
      unlockedAt: stage.sequence === 1 ? new Date() : null,
    }));

    await this.prisma.clusterStageProgress.createMany({
      data: progressData,
    });

    // Check if any stage has daysSinceStage condition to init BastTimer
    const hasBastTimerDependency = template.stages.some((s) => {
      const cond = s.triggerConditions as any;
      return cond?.daysSinceStage;
    });

    if (hasBastTimerDependency) {
      await this.prisma.bastTimer.create({
        data: { clusterId },
      });
    }

    return this.getClusterProgress(clusterId);
  }

  /**
   * METHOD 3: evaluateStageConditions
   */
  async evaluateStageConditions(
    clusterId: string,
    stageId: string,
  ): Promise<{ canUnlock: boolean; blockedReason?: string }> {
    const stage = await this.prisma.pipelineStage.findUnique({
      where: { id: stageId },
    });
    if (!stage) throw new NotFoundException('Stage not found');

    const conditions = stage.triggerConditions as any;
    if (!conditions) return { canUnlock: true };

    // 1. previousStageStatus: "DONE"
    if (conditions.previousStageStatus === 'DONE') {
      const prevStage = await this.prisma.pipelineStage.findFirst({
        where: {
          templateId: stage.templateId,
          sequence: stage.sequence - 1,
        },
      });
      if (prevStage) {
        const prevProgress = await this.prisma.clusterStageProgress.findUnique({
          where: { clusterId_stageId: { clusterId, stageId: prevStage.id } },
        });
        if (prevProgress?.status !== StageProgressStatus.DONE) {
          return {
            canUnlock: false,
            blockedReason: `Menunggu tahap sebelumnya (${prevStage.shortLabel}) selesai`,
          };
        }
      }
    }

    // 2. smileProgressMin: 90
    if (conditions.smileProgressMin != null) {
      const latestSmile = await this.prisma.smileProgress.findFirst({
        where: { clusterId },
        orderBy: { recordedAt: 'desc' },
      });
      if (!latestSmile || Number(latestSmile.progressPct) < conditions.smileProgressMin) {
        return {
          canUnlock: false,
          blockedReason: `Menunggu SMILE Progress ≥ ${conditions.smileProgressMin}% (saat ini: ${latestSmile ? latestSmile.progressPct : 0}%)`,
        };
      }
    }

    // 3. daysSinceStage: { stageSequence: 8, minDays: 365 }
    if (conditions.daysSinceStage) {
      const { stageSequence, minDays } = conditions.daysSinceStage;
      const targetStage = await this.prisma.pipelineStage.findFirst({
        where: { templateId: stage.templateId, sequence: stageSequence },
      });
      if (targetStage) {
        const targetProgress = await this.prisma.clusterStageProgress.findUnique({
          where: { clusterId_stageId: { clusterId, stageId: targetStage.id } },
        });
        if (!targetProgress?.completedAt) {
          return {
            canUnlock: false,
            blockedReason: `Menunggu tahap ${targetStage.shortLabel} selesai`,
          };
        }
        const elapsedDays =
          (Date.now() - targetProgress.completedAt.getTime()) / (1000 * 3600 * 24);
        if (elapsedDays < minDays) {
          return {
            canUnlock: false,
            blockedReason: `Menunggu ${minDays} hari sejak ${targetStage.shortLabel} (sisa: ${Math.ceil(minDays - elapsedDays)} hari)`,
          };
        }
      }
    }

    // 4. manualUnlock: true
    if (conditions.manualUnlock === true) {
      return {
        canUnlock: false,
        blockedReason: 'Memerlukan pembukaan kunci manual oleh Admin/GM',
      };
    }

    // 5. requireAllDocuments: true (for previous stage)
    if (conditions.requireAllDocuments === true) {
      const prevStage = await this.prisma.pipelineStage.findFirst({
        where: { templateId: stage.templateId, sequence: stage.sequence - 1 },
      });
      if (prevStage) {
        const docCheck = await this.checkStageDocuments(clusterId, prevStage.id);
        if (!docCheck.complete) {
          return {
            canUnlock: false,
            blockedReason: `Dokumen wajib di tahap ${prevStage.shortLabel} belum lengkap`,
          };
        }
      }
    }

    return { canUnlock: true };
  }

  /**
   * METHOD 4: advanceStage
   */
  async advanceStage(
    clusterId: string,
    currentStageId: string,
    actorId: string,
    actorRole: Role,
    notes?: string,
  ): Promise<any> {
    const [stage, progress] = await Promise.all([
      this.prisma.pipelineStage.findUnique({
        where: { id: currentStageId },
        include: { template: true },
      }),
      this.prisma.clusterStageProgress.findUnique({
        where: { clusterId_stageId: { clusterId, stageId: currentStageId } },
      }),
    ]);

    if (!stage || !progress) throw new NotFoundException('Stage progress not found');

    // 1. Verify actor role
    if (!stage.allowedActorRoles.includes(actorRole)) {
      throw new ForbiddenException(`Role ${actorRole} tidak diizinkan menyelesaikan tahap ini`);
    }

    // 2. Verify current status
    if (progress.status !== StageProgressStatus.ACTIVE) {
      throw new BadRequestException('Tahap ini tidak dalam status AKTIF');
    }

    // 3. Check documents for current stage
    const docCheck = await this.checkStageDocuments(clusterId, currentStageId);
    if (!docCheck.complete) {
      throw new BadRequestException(`Dokumen wajib belum lengkap: ${docCheck.missing.join(', ')}`);
    }

    // 4. Mark current stage DONE
    await this.prisma.clusterStageProgress.update({
      where: { id: progress.id },
      data: {
        status: StageProgressStatus.DONE,
        completedAt: new Date(),
        completedById: actorId,
        notes,
      },
    });

    // Special: BAST 1 issued at
    if (stage.shortLabel.includes('BAST 1') || stage.name.includes('BAST 1')) {
      await this.prisma.bastTimer.update({
        where: { clusterId },
        data: { bast1IssuedAt: new Date() },
      }).catch(() => {});
    }

    // 5. Evaluate next stage
    const nextStage = await this.prisma.pipelineStage.findFirst({
      where: {
        templateId: stage.templateId,
        sequence: stage.sequence + 1,
      },
    });

    if (nextStage) {
      const evaluation = await this.evaluateStageConditions(clusterId, nextStage.id);
      if (evaluation.canUnlock) {
        const nextProgress = await this.prisma.clusterStageProgress.update({
          where: { clusterId_stageId: { clusterId, stageId: nextStage.id } },
          data: {
            status: StageProgressStatus.ACTIVE,
            unlockedAt: new Date(),
          },
        });

        // Notify next stage roles
        for (const role of nextStage.notifyRoles) {
          await this.notifications.createForRole(role as Role, {
            title: `⚡ Tahap Baru: ${nextStage.name}`,
            message: `Cluster ${stage.template.name} telah memasuki tahap ${nextStage.name}.`,
            type: 'TASK',
            link: `/permit-clusters/${clusterId}`,
            entityId: clusterId,
          });
        }

        // 6. Recursive auto-advance
        if (nextStage.autoAdvance) {
          return this.advanceStage(clusterId, nextStage.id, actorId, actorRole, 'Auto-advanced');
        }
      }
    } else {
      // 7. Last stage -> Update PermitCluster
      await this.prisma.permitCluster.update({
        where: { id: clusterId },
        data: { status: PermitClusterStatus.COMPLETED },
      });
    }

    return this.getClusterProgress(clusterId);
  }

  /**
   * METHOD 5: manualUnlockStage
   */
  async manualUnlockStage(
    clusterId: string,
    stageId: string,
    actorId: string,
    reason: string,
  ) {
    const progress = await this.prisma.clusterStageProgress.findUnique({
      where: { clusterId_stageId: { clusterId, stageId } },
      include: { stage: true },
    });
    if (!progress) throw new NotFoundException('Stage progress not found');

    await this.prisma.clusterStageProgress.update({
      where: { id: progress.id },
      data: {
        status: StageProgressStatus.ACTIVE,
        unlockedAt: new Date(),
        notes: `Manual unlocked by Admin: ${reason}`,
      },
    });

    return this.getClusterProgress(clusterId);
  }

  /**
   * METHOD 6: getClusterProgress
   */
  async getClusterProgress(clusterId: string) {
    const progresses = await this.prisma.clusterStageProgress.findMany({
      where: { clusterId },
      include: {
        stage: {
          include: {
            requiredDocuments: {
              include: {
                uploads: {
                  where: { clusterId },
                },
              },
            },
          },
        },
      },
      orderBy: { stage: { sequence: 'asc' } },
    });

    const results = [];
    for (const p of progresses) {
      let blockedReason: string | undefined;
      if (p.status === StageProgressStatus.LOCKED) {
        const evalResult = await this.evaluateStageConditions(clusterId, p.stageId);
        if (!evalResult.canUnlock) {
          blockedReason = evalResult.blockedReason;
        }
      }
      results.push({ ...p, blockedReason });
    }

    return results;
  }

  /**
   * METHOD 7: checkStageDocuments
   */
  async checkStageDocuments(clusterId: string, stageId: string) {
    const docs = await this.prisma.stageDocument.findMany({
      where: { stageId },
      include: {
        uploads: {
          where: { clusterId },
        },
      },
    });

    const required = docs.filter((d) => d.isRequired);
    const missing = required
      .filter((d) => d.uploads.length === 0)
      .map((d) => d.name);

    return {
      complete: missing.length === 0,
      uploaded: docs.filter((d) => d.uploads.length > 0).map((d) => d.name),
      missing,
    };
  }

  /**
   * METHOD 8: uploadStageDocument
   */
  async uploadStageDocument(
    clusterId: string,
    stageDocumentId: string,
    fileUrl: string,
    fileName: string,
    uploadedById: string,
  ) {
    await this.prisma.stageDocumentUpload.create({
      data: {
        clusterId,
        stageDocumentId,
        fileUrl,
        fileName,
        uploadedById,
      },
    });

    // Re-evaluate next stage
    const upload = await this.prisma.stageDocumentUpload.findFirst({
      where: { clusterId, stageDocumentId },
      include: { stageDocument: { include: { stage: true } } },
    });
    
    if (upload) {
      const currentStage = upload.stageDocument.stage;
      const nextStage = await this.prisma.pipelineStage.findFirst({
        where: { templateId: currentStage.templateId, sequence: currentStage.sequence + 1 },
      });
      if (nextStage) {
        const evaluation = await this.evaluateStageConditions(clusterId, nextStage.id);
        if (evaluation.canUnlock) {
          await this.prisma.clusterStageProgress.update({
            where: { clusterId_stageId: { clusterId, stageId: nextStage.id } },
            data: { status: StageProgressStatus.ACTIVE, unlockedAt: new Date() },
          });
        }
      }
    }

    return this.getClusterProgress(clusterId);
  }

  /**
   * METHOD 9: recordSmileProgress
   */
  async recordSmileProgress(
    clusterId: string,
    progressPct: number,
    evidenceUrl: string | null,
    recordedById: string,
  ) {
    await this.prisma.smileProgress.create({
      data: {
        clusterId,
        progressPct,
        evidenceUrl,
        recordedById,
      },
    });

    // Re-evaluate stages with smileProgressMin
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      include: { pipelineTemplate: { include: { stages: true } } },
    });

    if (cluster?.pipelineTemplate) {
      for (const stage of cluster.pipelineTemplate.stages) {
        const cond = stage.triggerConditions as any;
        if (cond?.smileProgressMin) {
          const evaluation = await this.evaluateStageConditions(clusterId, stage.id);
          if (evaluation.canUnlock) {
            const progress = await this.prisma.clusterStageProgress.findUnique({
              where: { clusterId_stageId: { clusterId, stageId: stage.id } },
            });
            if (progress?.status === StageProgressStatus.LOCKED) {
              await this.prisma.clusterStageProgress.update({
                where: { id: progress.id },
                data: { status: StageProgressStatus.ACTIVE, unlockedAt: new Date() },
              });
              // Notify PM
              await this.notifications.createForUser(cluster.assignedPmId, {
                title: `📈 SMILE Progress Tercapai: ${stage.name}`,
                message: `Cluster ${cluster.clusterCode} kini bisa dilanjutkan ke tahap ${stage.name}.`,
                type: 'PERMIT_FLOW',
                link: `/permit-clusters/${clusterId}`,
                entityId: clusterId,
              });
            }
          }
        }
      }
    }

    return this.getClusterProgress(clusterId);
  }

  /**
   * METHOD 10: seedTemplate
   */
  async seedTemplate(dto: CreatePipelineTemplateDto) {
    const existing = await this.prisma.pipelineTemplate.findUnique({
      where: {
        fiberType_ispCustomerId_version: {
          fiberType: dto.fiberType,
          ispCustomerId: dto.ispCustomerId,
          version: dto.isActive === false ? 0 : 1, // Simple check
        },
      },
    });

    if (existing) return existing;

    return this.prisma.pipelineTemplate.create({
      data: {
        name: dto.name,
        fiberType: dto.fiberType,
        ispCustomerId: dto.ispCustomerId,
        isActive: dto.isActive ?? true,
        stages: {
          create: dto.stages.map((s) => ({
            sequence: s.sequence,
            name: s.name,
            shortLabel: s.shortLabel,
            color: s.color,
            triggerConditions: s.triggerConditions,
            autoAdvance: s.autoAdvance ?? false,
            notifyRoles: s.notifyRoles,
            allowedActorRoles: s.allowedActorRoles,
            requiredDocuments: {
              create: s.requiredDocuments?.map((d) => ({
                name: d.name,
                description: d.description,
                formats: d.formats,
                isRequired: d.isRequired ?? true,
              })),
            },
          })),
        },
      },
    });
  }

  /**
   * METHOD 11: Legacy Bridge
   */
  async getProgressMode(clusterId: string): Promise<'ENGINE' | 'LEGACY'> {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      select: { pipelineTemplateId: true },
    });
    return cluster?.pipelineTemplateId ? 'ENGINE' : 'LEGACY';
  }
}
