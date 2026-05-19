import { Module } from '@nestjs/common';
import { PrBrService } from './pr-br.service';
import { PrBrController } from './pr-br.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, PermitClusterModule],
  controllers: [PrBrController],
  providers: [PrBrService],
  exports: [PrBrService],
})
export class PrBrModule {}
