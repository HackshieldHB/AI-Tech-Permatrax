import { Injectable, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { BaSurveyService } from '../ba-survey/ba-survey.service';
import { Role, SurveyDataStatus } from '@prisma/client';

@Injectable()
export class SurveyDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permitCluster: PermitClusterService,
    @Inject(forwardRef(() => BaSurveyService))
    private readonly baSurvey: BaSurveyService,
  ) {}

  private async loadCluster(clusterId: string, userId: string, userRole: Role, opts: { writeAction?: boolean } = {}) {
    const pc = await this.prisma.permitCluster.findUnique({ where: { id: clusterId } });
    if (!pc) throw new NotFoundException('Cluster tidak ditemukan');
    // FIX Issue 8: Only enforce "assigned PM" check for WRITE actions. Reads (viewing pipeline detail) must
    // be allowed for any PM in the correct fiber type so they can see survey data, evidence, SIP status, etc.
    if (
      opts.writeAction &&
      ([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole) &&
      pc.assignedPmId !== userId
    ) {
      throw new ForbiddenException('Bukan PM untuk cluster ini'); // FIX Issue 8: retain guard for writes only
    }
    return pc;
  }

  private baseCreate(permitClusterId: string, userId: string): Prisma.SurveyDataCreateInput {
    return {
      permitCluster: { connect: { id: permitClusterId } },
      conductor: { connect: { id: userId } },
      status: 'IN_PROGRESS',
      evidencePhotos: [],
    };
  }

  /** NEW */
  async createOrUpdate(
    permitClusterId: string,
    dto: Record<string, unknown>,
    userId: string,
    userRole: Role,
  ) {
    await this.loadCluster(permitClusterId, userId, userRole, { writeAction: true }); // FIX Issue 8: gate WRITE with assigned-PM rule

    const row = await this.prisma.surveyData.upsert({
      where: { permitClusterId },
      create: {
        ...this.baseCreate(permitClusterId, userId),
        ...(dto.conductedAt && { conductedAt: new Date(String(dto.conductedAt)) }),
        rtName: dto.rtName != null ? String(dto.rtName) : undefined,
        rtPhone: dto.rtPhone != null ? String(dto.rtPhone) : undefined,
        rwName: dto.rwName != null ? String(dto.rwName) : undefined,
        rwPhone: dto.rwPhone != null ? String(dto.rwPhone) : undefined,
        pengelolaName: dto.pengelolaName != null ? String(dto.pengelolaName) : undefined,
        pengelolaPhone: dto.pengelolaPhone != null ? String(dto.pengelolaPhone) : undefined,
        stakeholderNotes: dto.stakeholderNotes != null ? String(dto.stakeholderNotes) : undefined,
      },
      update: {
        conductor: { connect: { id: userId } },
        ...(dto.conductedAt && { conductedAt: new Date(String(dto.conductedAt)) }),
        ...(dto.rtName !== undefined && { rtName: dto.rtName == null ? null : String(dto.rtName) }),
        ...(dto.rtPhone !== undefined && { rtPhone: dto.rtPhone == null ? null : String(dto.rtPhone) }),
        ...(dto.rwName !== undefined && { rwName: dto.rwName == null ? null : String(dto.rwName) }),
        ...(dto.rwPhone !== undefined && { rwPhone: dto.rwPhone == null ? null : String(dto.rwPhone) }),
        ...(dto.pengelolaName !== undefined && {
          pengelolaName: dto.pengelolaName == null ? null : String(dto.pengelolaName),
        }),
        ...(dto.pengelolaPhone !== undefined && {
          pengelolaPhone: dto.pengelolaPhone == null ? null : String(dto.pengelolaPhone),
        }),
        ...(dto.stakeholderNotes !== undefined && {
          stakeholderNotes: dto.stakeholderNotes == null ? null : String(dto.stakeholderNotes),
        }),
      },
    });

    await this.permitCluster.advancePhaseInternal(permitClusterId, 'SITE_VISIT');
    return row;
  }

  /** NEW */
  async submitSiteVisit(permitClusterId: string, dto: Record<string, unknown>, userId: string, userRole: Role) {
    await this.loadCluster(permitClusterId, userId, userRole, { writeAction: true }); // FIX Issue 8: gate WRITE with assigned-PM rule

    const row = await this.prisma.surveyData.upsert({
      where: { permitClusterId },
      create: {
        ...this.baseCreate(permitClusterId, userId),
        conductedAt: dto.conductedAt ? new Date(String(dto.conductedAt)) : undefined,
        rtName: dto.rtName != null ? String(dto.rtName) : undefined,
        rtPhone: dto.rtPhone != null ? String(dto.rtPhone) : undefined,
        rwName: dto.rwName != null ? String(dto.rwName) : undefined,
        rwPhone: dto.rwPhone != null ? String(dto.rwPhone) : undefined,
        pengelolaName: dto.pengelolaName != null ? String(dto.pengelolaName) : undefined,
        pengelolaPhone: dto.pengelolaPhone != null ? String(dto.pengelolaPhone) : undefined,
        stakeholderNotes: dto.stakeholderNotes != null ? String(dto.stakeholderNotes) : undefined,
      },
      update: {
        conductor: { connect: { id: userId } },
        ...(dto.conductedAt && { conductedAt: new Date(String(dto.conductedAt)) }),
        ...(dto.rtName !== undefined && { rtName: dto.rtName == null ? null : String(dto.rtName) }),
        ...(dto.rtPhone !== undefined && { rtPhone: dto.rtPhone == null ? null : String(dto.rtPhone) }),
        ...(dto.rwName !== undefined && { rwName: dto.rwName == null ? null : String(dto.rwName) }),
        ...(dto.rwPhone !== undefined && { rwPhone: dto.rwPhone == null ? null : String(dto.rwPhone) }),
        ...(dto.pengelolaName !== undefined && {
          pengelolaName: dto.pengelolaName == null ? null : String(dto.pengelolaName),
        }),
        ...(dto.pengelolaPhone !== undefined && {
          pengelolaPhone: dto.pengelolaPhone == null ? null : String(dto.pengelolaPhone),
        }),
        ...(dto.stakeholderNotes !== undefined && {
          stakeholderNotes: dto.stakeholderNotes == null ? null : String(dto.stakeholderNotes),
        }),
      },
    });

    await this.permitCluster.advancePhaseInternal(permitClusterId, 'SURVEY_INPUT');
    return row;
  }

  /** NEW */
  async submitSurveyInput(permitClusterId: string, dto: Record<string, unknown>, userId: string, userRole: Role) {
    await this.loadCluster(permitClusterId, userId, userRole, { writeAction: true }); // FIX Issue 8: gate WRITE with assigned-PM rule

    const prev = await this.prisma.surveyData.findUnique({ where: { permitClusterId } });
    const photos = (dto.evidencePhotos as string[] | undefined) ?? prev?.evidencePhotos ?? [];

    const row = await this.prisma.surveyData.upsert({
      where: { permitClusterId },
      create: {
        ...this.baseCreate(permitClusterId, userId),
        areaCondition: dto.areaCondition != null ? String(dto.areaCondition) : undefined,
        accessDifficulty: dto.accessDifficulty != null ? String(dto.accessDifficulty) : undefined,
        existingInfra: dto.existingInfra != null ? String(dto.existingInfra) : undefined,
        surveyNotes: dto.surveyNotes != null ? String(dto.surveyNotes) : undefined,
        evidencePhotos: photos,
      },
      update: {
        conductor: { connect: { id: userId } },
        ...(dto.areaCondition !== undefined && {
          areaCondition: dto.areaCondition == null ? null : String(dto.areaCondition),
        }),
        ...(dto.accessDifficulty !== undefined && {
          accessDifficulty: dto.accessDifficulty == null ? null : String(dto.accessDifficulty),
        }),
        ...(dto.existingInfra !== undefined && {
          existingInfra: dto.existingInfra == null ? null : String(dto.existingInfra),
        }),
        ...(dto.surveyNotes !== undefined && {
          surveyNotes: dto.surveyNotes == null ? null : String(dto.surveyNotes),
        }),
        evidencePhotos: photos,
      },
    });

    await this.permitCluster.advancePhaseInternal(permitClusterId, 'ROUTE_SURVEY');
    return row;
  }

  /** NEW */
  async submitRouteSurvey(permitClusterId: string, dto: Record<string, unknown>, userId: string, userRole: Role) {
    await this.loadCluster(permitClusterId, userId, userRole, { writeAction: true }); // FIX Issue 8: gate WRITE with assigned-PM rule

    const routeData = {
      conductor: { connect: { id: userId } },
      routeGeoJson: dto.routeGeoJson === undefined ? undefined : (dto.routeGeoJson as Prisma.InputJsonValue),
      homepasCount: dto.homepasCount != null ? Number(dto.homepasCount) : undefined,
      homepasCoords: dto.homepasCoords === undefined ? undefined : (dto.homepasCoords as Prisma.InputJsonValue),
      polePositions: dto.polePositions === undefined ? undefined : (dto.polePositions as Prisma.InputJsonValue),
      routeNotes: dto.routeNotes != null ? String(dto.routeNotes) : undefined,
      routeDistanceM: dto.routeDistanceM != null ? Number(dto.routeDistanceM) : undefined,
      status: 'COMPLETED' as SurveyDataStatus,
      completedAt: new Date(),
    };

    const row = await this.prisma.surveyData.upsert({
      where: { permitClusterId },
      create: {
        ...this.baseCreate(permitClusterId, userId),
        ...routeData,
      },
      update: { conductor: { connect: { id: userId } }, ...routeData },
    });

    await this.baSurvey.generateBaSurvey(permitClusterId, userId);
    return row;
  }

  /** NEW */
  async findOne(permitClusterId: string, userId: string, userRole: Role) {
    await this.loadCluster(permitClusterId, userId, userRole);
    return this.prisma.surveyData.findUnique({ where: { permitClusterId } });
  }

  async addEvidence(
    permitClusterId: string,
    files: Array<{ fileUrl: string; fileName: string; mimeType?: string; fileSize?: number }>,
    meta: { latitude?: number; longitude?: number; capturedAt?: Date },
    userId: string,
  ) {
    const survey = await this.prisma.surveyData.findUnique({ where: { permitClusterId } });
    if (!survey) throw new NotFoundException('Survey data tidak ditemukan'); // NEW: evidence requires survey record
    const rows = await Promise.all(
      files.map((file) =>
        this.prisma.surveyEvidence.create({
          data: {
            surveyDataId: survey.id,
            fileUrl: file.fileUrl,
            fileName: file.fileName,
            mimeType: file.mimeType,
            fileSize: file.fileSize,
            latitude: meta.latitude ?? null,
            longitude: meta.longitude ?? null,
            capturedAt: meta.capturedAt ?? null,
            uploadedBy: userId,
          },
        }),
      ),
    );
    return rows;
  }

  async getEvidenceForCluster(clusterId: string) {
    const survey = await this.prisma.surveyData.findUnique({ where: { permitClusterId: clusterId } });
    if (!survey) return [];
    return this.prisma.surveyEvidence.findMany({ where: { surveyDataId: survey.id }, orderBy: { uploadedAt: 'desc' } }); // NEW: cluster evidence listing
  }
}


