import { Injectable, UnauthorizedException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { verifyPassword, hashPassword } from './utils/password.util';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../redis/redis.provider';
import Redis from 'ioredis';

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
    user: {
    id: string;
    email: string;
    name: string;
    role: string;
    fiberType: string | null;
    signatureUrl: string | null;
    avatarUrl: string | null;
  };
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // FIX: Inject globally provided Redis Client for distributed token blacklisting
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  private readonly profileSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    fiberType: true,
    isActive: true,
    signatureUrl: true,
    avatarUrl: true,
    phone: true,
    address: true,
  } as const;

  async validateUser(email: string, pass: string): Promise<any> {
    // FIX: safe debug log — email only, never password or hash
    this.logger.debug(`[Auth] Login attempt for: ${email}`);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        fiberType: true,
        isActive: true,
        password: true,
        refreshToken: true,
      },
    });

    if (!user) {
      // FIX: do NOT reveal whether the email exists — log only the failed attempt
      this.logger.warn(`[Auth] Login failed for: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isActive === false) {
      // FIX: log only userId + role, never credentials
      this.logger.warn(`[Auth] Login blocked (deactivated): ${user.id} (${user.role})`);
      throw new UnauthorizedException('Account deactivated');
    }

    if (!user.password) {
      // FIX: keep operational alert but never print hash or plaintext
      this.logger.error(
        `[Auth] Missing password hash for user ${user.id}. Run prisma generate and restart the API.`,
      );
      throw new UnauthorizedException('System Error: Credentials mapping failed');
    }

    const isMatch = await verifyPassword(pass, user.password);

    if (!isMatch) {
      // FIX: generic failure log — no password, no hash, no bcrypt result leak
      this.logger.warn(`[Auth] Login failed for: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { password, refreshToken, ...safeUser } = user;
    return safeUser;
  }

  async login(user: any): Promise<LoginResponse> {
    const jti = crypto.randomUUID(); 

    const payload = { 
        email: user.email, 
        sub: user.id, 
        role: user.role, 
        jti 
    };
    
    const accessToken = await this.jwtService.signAsync(payload, {
        expiresIn: '8h'
    });
    
    const rawRefreshToken = crypto.randomUUID();
    const hashedRefresh = await hashPassword(rawRefreshToken); 
    
    await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: hashedRefresh }
    });

    this.logger.log(`[AUDIT] Login Success - UserID: ${user.id} - Role: ${user.role}`);

    return { 
        accessToken, 
        refreshToken: rawRefreshToken, 
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            fiberType: user.fiberType,
            signatureUrl: (user as any).signatureUrl ?? null,
            avatarUrl: (user as any).avatarUrl ?? null,
        }
    };
  }

  async refreshAccessToken(userId: string, rawRefreshToken: string) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.refreshToken) {
          throw new UnauthorizedException('Refresh token invalid');
      }

      const isValid = await verifyPassword(rawRefreshToken, user.refreshToken); 
      if (!isValid) {
          throw new UnauthorizedException('Refresh token invalid');
      }

      const jti = crypto.randomUUID();
      const payload = { email: user.email, sub: user.id, role: user.role, jti };
      const accessToken = await this.jwtService.signAsync(payload, { expiresIn: '8h' });

      return { accessToken };
  }

  async logout(userId: string, jti?: string, tokenTtlSeconds?: number) {
      await this.prisma.user.update({
          where: { id: userId },
          data: { refreshToken: null }
      });

      if (jti && tokenTtlSeconds) {
          await this.blacklistToken(jti, tokenTtlSeconds);
      } else if (jti) {
          // Default to 8h fallback if undefined
          await this.blacklistToken(jti, 8 * 60 * 60);
      }

      return { message: 'Logged out successfully' };
  }

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    // FIX: Persist in Redis with TTL matching token expiry — survives server restart
    await this.redis.setex(`blacklist:${jti}`, ttlSeconds, '1');
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    try {
      const result = await this.redis.get(`blacklist:${jti}`);
      return result !== null;
    } catch (err) {
      // FIX: fail-open — a Redis outage must not lock out all authenticated users.
      // Log a warning and allow the request through. Revoked tokens may briefly work
      // during an outage, which is an acceptable trade-off vs. total service unavailability.
      this.logger.warn(`[Auth] Redis blacklist check failed (fail-open): ${(err as Error).message}`);
      return false;
    }
  }

  /** Profil aman untuk GET /auth/me — sinkron dengan JWT + DB */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.profileSelect,
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account deactivated');
    }
    return { success: true, data: user };
  }

  /**
   * Self-service change password — hanya bisa untuk akun sendiri.
   * Wajib verifikasi currentPassword sebelum update.
   * Session (refreshToken) di-invalidate agar user login ulang dengan password baru.
   */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Akun tidak ditemukan atau tidak aktif');
    }

    // Verifikasi password saat ini — tolak tanpa membocorkan info DB
    const isCurrentValid = await verifyPassword(currentPassword, user.password);
    if (!isCurrentValid) {
      this.logger.warn(`[Auth] changeOwnPassword failed — wrong current password for user ${userId}`);
      throw new BadRequestException('Password saat ini tidak sesuai');
    }

    const newHash = await hashPassword(newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: newHash,
        refreshToken: null, // Invalidate semua sesi aktif — wajib login ulang
      },
    });

    this.logger.log(`[AUDIT] changeOwnPassword - UserID: ${userId}`);

    return { success: true, message: 'Password berhasil diubah. Silakan login kembali.' };
  }

  async updateProfile(
    userId: string,
    data: { name?: string; signatureUrl?: string; phone?: string | null; address?: string | null },
  ) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.signatureUrl !== undefined ? { signatureUrl: data.signatureUrl } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
      },
      select: this.profileSelect,
    });
    return { success: true, data: updated };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Format file harus JPG, PNG, atau WebP');
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('Ukuran file maksimal 2MB');
    }

    const avatarUrl = await this.storage.uploadMulterFile(file, 'avatars', userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: this.profileSelect,
    });
    return { success: true, data: updated };
  }
}
