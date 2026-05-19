import { Module } from '@nestjs/common';
import { CleanListController } from './clean-list.controller';
import { CleanListService } from './clean-list.service';
import { PrismaModule } from '../prisma/prisma.module';

// NEW: CleanListModule — manages ISP cluster data
@Module({
  imports:     [PrismaModule],
  controllers: [CleanListController],
  providers:   [CleanListService],
  exports:     [CleanListService],
})
export class CleanListModule {}
