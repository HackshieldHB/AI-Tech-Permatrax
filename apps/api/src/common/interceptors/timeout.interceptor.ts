import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { TIMEOUT_MS_KEY } from '../decorators/timeout-ms.decorator';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const override = this.reflector.getAllAndOverride<number>(TIMEOUT_MS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Default 10s; GIS buildings/route may set 30–45s via @TimeoutMs
    const ms = typeof override === 'number' && override > 0 ? override : 10000;

    return next.handle().pipe(
      timeout(ms),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException('Request timed out. Please try again.'),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
