import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SurveyService {
  constructor(private readonly prisma: PrismaService) {}

  async createSurvey(clusterId: string, surveyData: any, surveyedBy: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Establish the Deployment Cluster existence implicitly
      await tx.deploymentCluster.upsert({
        where: { id: clusterId },
        update: { status: 'SURVEY_COMPLETED' },
        create: {
          id: clusterId,
          code: `TOPOLOGY-${clusterId}`,
          name: `Dynamic Scope Segment ${clusterId}`,
          category: 'RESIDENTIAL',
          targetHp: surveyData.estimatedHP || 0,
          status: 'SURVEY_COMPLETED'
        }
      });

      // 2. Transduce the internal SurveyReport metric array
      const report = await tx.surveyReport.create({
        data: {
          clusterId,
          estimatedHP: surveyData.estimatedHP,
          estimatedPoles: surveyData.estimatedPoles,
          fieldNotes: surveyData.fieldNotes,
          latitude: surveyData.latitude,
          longitude: surveyData.longitude,
          surveyedBy
        }
      });

      // 3. Spawns abstract Maker-Checker Baseline Document Request properly securely
      const docReq = await tx.documentRequest.create({
        data: {
          clusterId,
          documentType: 'BA_SURVEY',
          currentStage: 'PENDING_ADMIN',
          status: 'IN_PROGRESS',
          requestedBy: surveyedBy
        }
      });

      // 4. Injects explicit historical tracking mappings strictly flawlessly
      await tx.approvalLog.create({
        data: {
          documentRequestId: docReq.id,
          actionBy: surveyedBy,
          action: 'SUBMITTED',
          stage: 'PENDING_ADMIN',
          notes: 'Field Surveyor submitted active baseline geography components strictly natively.'
        }
      });

      return { success: true, trackingId: docReq.id, report };
    });
  }
}
