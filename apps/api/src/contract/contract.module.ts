import { Module } from '@nestjs/common';
import { ContractService } from './contract.service';
import { ContractController } from './contract.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, PermitClusterModule],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
