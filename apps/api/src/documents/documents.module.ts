import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PrismaModule } from '../prisma/prisma.module'; // FIX: provide PrismaService dependency for DocumentsService
import { StorageModule } from '../storage/storage.module'; // FIX: provide StorageService dependency for DocumentsService

@Module({
  imports: [PrismaModule, StorageModule], // FIX: only module dependencies used by DocumentsService
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService], // FIX: export service for cross-module usage
})
export class DocumentsModule {}
