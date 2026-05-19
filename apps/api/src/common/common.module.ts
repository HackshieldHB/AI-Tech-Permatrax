import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DownloadTokenService } from './services/download-token.service';

/**
 * FIX: global shared services (HMAC download tokens, etc.)
 * Exposed as @Global() so controllers don't need to import CommonModule everywhere.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [DownloadTokenService],
  exports: [DownloadTokenService],
})
export class CommonModule {}
