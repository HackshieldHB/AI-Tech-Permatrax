import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ChatRequestDto,
  ChatRequestSchema,
  FeedbackRequestDto,
  FeedbackRequestSchema,
} from './ai.dto';
import { AiService } from './ai.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('health')
  health() {
    return this.aiService.health();
  }

  @Post('chat')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  chat(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChatRequestSchema)) body: ChatRequestDto,
  ) {
    return this.aiService.chat(user, body.message, body.conversationId);
  }

  @Post('feedback')
  feedback(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(FeedbackRequestSchema))
    body: FeedbackRequestDto,
  ) {
    return this.aiService.feedback(
      user,
      body.messageId,
      body.rating,
      body.comment,
    );
  }
}
