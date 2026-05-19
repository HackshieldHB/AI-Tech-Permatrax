import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthService } from './auth.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from './decorators/public.decorator';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SelfChangePasswordSchema } from '../user/user.dto';
import { z } from 'zod';

const UpdateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  signatureUrl: z.string().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
});

@ApiTags('Authentication Gateway')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(AuthGuard('local')) // FIX: Local hook explicit definition
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // FIX: Max 5 login attempts per 60 seconds per IP — brute force protection
  @Post('login')
  @ApiOperation({ summary: 'Validate identity arrays natively explicitly gracefully internal' })
  async login(@Req() req: Request) {
    // FIX: Passing the user attached by local strategy execution
    return this.authService.login(req.user);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Issue explicit Access Tokens inherently precise carefully purely optimally gracefully softly clean implicitly inherently identically' })
  async refresh(@Body() body: { userId: string, refreshToken: string }) {
      return this.authService.refreshAccessToken(body.userId, body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Wipe current valid internal states seamlessly natively internally cleanly implicitly' })
  async logout(@Req() req: any) {
      const ttl = req.user.exp ? Math.floor(req.user.exp - Date.now() / 1000) : 8 * 60 * 60;
      // FIX: Extracts internal tracking state purely securely
      return this.authService.logout(req.user.userId, req.user.jti, ttl);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Profil user dari database' })
  async getMe(@Req() req: any) {
    const result = await this.authService.getProfile(req.user.userId);
    return result.data;
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update profil sendiri' })
  async updateProfile(@Req() req: any, @Body() body: unknown) {
    const dto = UpdateProfileSchema.parse(body);
    return this.authService.updateProfile(req.user.userId, dto);
  }

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload foto profil (max 2MB, JPG/PNG/WebP)' })
  async uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File foto wajib diunggah');
    }
    return this.authService.uploadAvatar(req.user.userId, file);
  }

  /**
   * Self-service change password — user ganti password sendiri.
   * Wajib mengirim currentPassword untuk verifikasi identitas.
   * Session di-invalidate setelah berhasil → user harus login ulang.
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // Max 5x per menit per IP
  @ApiOperation({ summary: 'Ganti password sendiri (wajib verifikasi password lama)' })
  async changeOwnPassword(@Req() req: any, @Body() body: unknown) {
    const { currentPassword, newPassword } = SelfChangePasswordSchema.parse(body);
    return this.authService.changeOwnPassword(req.user.userId, currentPassword, newPassword);
  }
}
