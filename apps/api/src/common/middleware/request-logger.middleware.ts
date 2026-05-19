import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = crypto.randomUUID();
    const { ip, method, originalUrl } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length');
      const executionTime = Date.now() - startTime;
      
      this.logger.log(
        `[${requestId}] ${method} ${originalUrl} ${statusCode} ${contentLength} - IP: ${ip} - UA: ${userAgent} - ${executionTime}ms`
      );
    });

    next();
  }
}
