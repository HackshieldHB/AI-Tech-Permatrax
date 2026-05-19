import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';

@Module({
  imports: [PrismaModule],
  controllers: [DesignController],
  providers: [DesignService],
})
export class DesignModule {}
