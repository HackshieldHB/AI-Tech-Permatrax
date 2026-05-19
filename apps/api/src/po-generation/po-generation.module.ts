import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ProcurementMailModule } from '../procurement-mail/procurement-mail.module';
import { PoGenerationService } from './po-generation.service';

@Module({
  imports: [PrismaModule, StorageModule, ProcurementMailModule],
  providers: [PoGenerationService],
  exports: [PoGenerationService],
})
export class PoGenerationModule {}
