import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Prisma } from '@prisma/client';
import { captureApiExceptionForSentry } from '../../sentry/capture-api-exception';

// NEW: Global exception filter — consistent JSON errors; Prisma + Zod aware
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const isProd = process.env.NODE_ENV === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Terjadi kesalahan pada server';
    let error = 'Internal Server Error';
    const extras: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string) || message;
        error = (b.error as string) || exception.name;
        if (Array.isArray(b.message)) message = (b.message as string[]).join(', ');
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          error = 'Conflict';
          message = 'Data sudah ada (unik) — duplikat tidak diizinkan';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          error = 'Not Found';
          message = 'Data tidak ditemukan';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          error = 'Bad Request';
          message = 'Referensi data tidak valid';
          break;
        default:
          this.logger.error(`Prisma ${exception.code}: ${exception.message}`, exception.stack);
          message = isProd ? message : exception.message;
      }
    } else if (exception instanceof Error) {
      // Multer file-size / unexpected field errors surface as plain Error (or MulterError)
      const multerCode = (exception as Error & { code?: string }).code;
      if (multerCode === 'LIMIT_FILE_SIZE') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        error = 'Payload Too Large';
        message = 'File terlalu besar. Maksimal ukuran upload adalah 50 MB.';
      } else {
        this.logger.error(exception.message, exception.stack);
        message = isProd ? message : exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}`, exception instanceof Error ? exception.stack : String(exception));
    }

    captureApiExceptionForSentry(exception, status);

    res.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
      ...extras,
    });
  }
}
