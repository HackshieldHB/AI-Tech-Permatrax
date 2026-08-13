import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiController } from './ai.controller';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiOllamaService } from './ai-ollama.service';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiKnowledgeService,
    AiOllamaService,
    AiToolsService,
  ],
  exports: [AiService],
})
export class AiModule {}
