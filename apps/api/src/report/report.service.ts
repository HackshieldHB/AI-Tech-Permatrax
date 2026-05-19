import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAuditCsv(): Promise<string> {
     // Fetch deep topological tree
     const clusters = await this.prisma.deploymentCluster.findMany({
        include: {
           surveyReport: true,
           documentRequest: {
              include: {
                 approvalLogs: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                 }
              }
           }
        },
        orderBy: { createdAt: 'desc' }
     });

     const headers = [
        'Cluster Code',
        'Name',
        'Category',
        'Current Status',
        'Proposed Budget (IDR)',
        'Estimated HP',
        'Estimated Poles',
        'Last Action',
        'Last Action Date'
     ].map(h => `"${h}"`).join(',');

     const rows = clusters.map(c => {
        const docReq = c.documentRequest;
        const lastLog = docReq && docReq.approvalLogs.length > 0 ? docReq.approvalLogs[0] : null;
        
        const code = c.code || '';
        const name = c.name || '';
        const category = c.category || '';
        const status = c.status || '';
        const budget = c.proposedBudget?.toString() || '0';
        
        const estHp = c.surveyReport?.estimatedHP?.toString() || '0';
        const estPoles = c.surveyReport?.estimatedPoles?.toString() || '0';
        
        const lastAction = lastLog ? `${lastLog.actionBy} (${lastLog.action} at ${lastLog.stage})` : 'Awaiting Processing';
        const actionDate = lastLog ? new Date(lastLog.createdAt).toISOString() : '';

        // Safely escape CSV strings
        return [
           `"${code}"`,
           `"${name.replace(/"/g, '""')}"`,
           `"${category}"`,
           `"${status}"`,
           `"${budget}"`,
           `"${estHp}"`,
           `"${estPoles}"`,
           `"${lastAction.replace(/"/g, '""')}"`,
           `"${actionDate}"`
        ].join(',');
     });

     return [headers, ...rows].join('\n');
  }
}
