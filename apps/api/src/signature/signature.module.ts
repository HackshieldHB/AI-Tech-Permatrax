import { Module } from '@nestjs/common';
import { SignatureService } from './signature.service';
import { SignatureValidateController } from './signature.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule],
  controllers: [SignatureValidateController],
  providers: [SignatureService],
  exports: [SignatureService],
})
export class SignatureModule {}
