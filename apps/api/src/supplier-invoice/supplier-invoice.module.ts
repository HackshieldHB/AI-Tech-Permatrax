import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcurementMailModule } from '../procurement-mail/procurement-mail.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupplierInvoiceController } from './supplier-invoice.controller';
import { SupplierInvoiceService } from './supplier-invoice.service';

@Module({
  imports: [PrismaModule, ProcurementMailModule, StorageModule, NotificationsModule],
  controllers: [SupplierInvoiceController],
  providers: [SupplierInvoiceService],
  exports: [SupplierInvoiceService],
})
export class SupplierInvoiceModule {}
