import { Module } from '@nestjs/common';
import { VisitRequestController } from './visit-request.controller';
import { VisitRequestService } from './visit-request.service';
import { BaOpenModule } from '../ba-open/ba-open.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

// NEW: VisitRequestModule — manages the full visit approval chain
@Module({
  imports:     [PrismaModule, BaOpenModule, PermitClusterModule],
  controllers: [VisitRequestController],
  providers:   [VisitRequestService],
  exports:     [VisitRequestService],
})
export class VisitRequestModule {}
