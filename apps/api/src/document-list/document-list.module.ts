import { Module } from '@nestjs/common'; // FIX: Nest module
import { DocumentListService } from './document-list.service'; // FIX: service
import { DocumentListController } from './document-list.controller'; // FIX: controller
import { PrismaModule } from '../prisma/prisma.module'; // FIX: prisma
import { IspEmailModule } from '../isp-email/isp-email.module'; // FIX: SMTP service

@Module({
  imports: [PrismaModule, IspEmailModule], // FIX: wire email module
  controllers: [DocumentListController], // FIX
  providers: [DocumentListService], // FIX
})
export class DocumentListModule {} // FIX: export
