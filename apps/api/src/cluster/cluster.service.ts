import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClusterService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.deploymentCluster.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async create(data: any) {
    return this.prisma.deploymentCluster.create({
       data: {
          code: data.code || `CLUS-${Date.now()}`,
          name: data.name,
          category: data.category || 'RESIDENTIAL',
          targetHp: data.targetHp || 0,
          status: 'PLANNING'
       }
    });
  }

  async getSpatial() {
    return this.prisma.deploymentCluster.findMany({
       include: {
          surveyReport: true
       }
    });
  }
}
