import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottleExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: 429,
      error: 'Too Many Requests',
      // FIX: Indonesian message matching frontend toast explicitly
      message: 'Terlalu banyak percobaan login. Coba lagi dalam 60 detik.',
      retryAfter: 60,
    });
  }
}
