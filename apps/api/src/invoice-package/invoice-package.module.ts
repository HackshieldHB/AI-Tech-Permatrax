import { Module } from '@nestjs/common';
import { InvoicePackageService } from './invoice-package.service';
import { InvoicePackageController } from './invoice-package.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule],
  controllers: [InvoicePackageController],
  providers: [InvoicePackageService],
  exports: [InvoicePackageService],
})
export class InvoicePackageModule {}
