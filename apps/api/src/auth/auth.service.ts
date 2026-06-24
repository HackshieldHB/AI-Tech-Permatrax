import { Injectable, UnauthorizedException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { verifyPassword, hashPassword } from './utils/password.util';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../redis/redis.provider';
import Redis from 'ioredis';
import { MailQueueService } from '../mail/mail-queue.service';

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
    private readonly mailQueue: MailQueueService,
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

  /**
   * Per-user signing secret for password-reset tokens. Binding the user's CURRENT
   * password hash into the secret makes the token single-use: once the password is
   * reset (or changed) the hash changes and any outstanding link can no longer be
   * verified. No DB column / migration required.
   */
  private resetTokenSecret(passwordHash: string): string {
    const base =
      this.configService.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET ?? '';
    return `${base}:pwreset:${passwordHash}`;
  }

  /** Absolute base URL for building the reset link (handles comma-separated CORS lists + basePath). */
  private frontendBaseUrl(): string {
    const raw =
      this.configService.get<string>('FRONTEND_URL') ??
      process.env.FRONTEND_URL ??
      'http://localhost:3000';
    return raw.split(',')[0].trim().replace(/\/+$/, '');
  }

  /**
   * Self-service password reset — step 1. Always resolves successfully so the
   * response never reveals whether an account exists (no enumeration). When the
   * email maps to an active account, a single-use reset link is emailed.
   */
  async forgotPassword(email: string): Promise<{ success: true }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, name: true, password: true, isActive: true },
    });

    if (user && user.isActive && user.password) {
      const token = await this.jwtService.signAsync(
        { sub: user.id, purpose: 'pwreset' },
        { secret: this.resetTokenSecret(user.password), expiresIn: '30m' },
      );
      const link = `${this.frontendBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      const from =
        this.configService.get<string>('SMTP_FROM') ??
        this.configService.get<string>('PROCUREMENT_FROM_EMAIL') ??
        this.configService.get<string>('SMTP_USER') ??
        process.env.SMTP_FROM ??
        process.env.SMTP_USER;

      // Escape the display name before embedding it in HTML.
      const safeName = (user.name || 'Pengguna').replace(
        /[<>&"]/g,
        (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string),
      );
      const year = new Date().getFullYear();

      await this.mailQueue.enqueue({
        mailOptions: {
          ...(from ? { from: `PermaTrax <${from}>` } : {}),
          to: user.email,
          subject: 'Reset Password Akun PermaTrax Anda',
          text:
            `PermaTrax — Reset Password\n\n` +
            `Halo ${user.name},\n\n` +
            `Kami menerima permintaan untuk mereset password akun PermaTrax Anda.\n` +
            `Buka tautan berikut untuk membuat password baru:\n\n${link}\n\n` +
            `Link ini berlaku selama 30 menit.\n\n` +
            `Jika Anda tidak meminta reset password, abaikan email ini — password Anda tidak akan berubah.\n\n` +
            `Best regards,\n` +
            `PT Integra Aplikasi Artifisial (AITECH)\n` +
            `https://aitech-ilt.co.id`,
          html: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2F8;margin:0;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E4E0EA">
      <tr><td style="background:#211A4D;padding:22px 32px">
        <span style="color:#FFFFFF;font-size:22px;font-weight:800;letter-spacing:-0.5px">Perma<span style="color:#FF8A7A">Trax</span></span>
      </td></tr>
      <tr><td style="padding:32px 32px 8px">
        <h1 style="margin:0 0 6px;font-size:22px;color:#211A4D">Reset Password</h1>
        <p style="margin:0 0 18px;font-size:15px;color:#202124">Halo <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#4B4858">Kami menerima permintaan untuk mereset password akun <strong>PermaTrax</strong> Anda. Klik tombol di bawah ini untuk membuat password baru.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 22px"><tr>
          <td align="center" bgcolor="#7C5CFC" style="border-radius:12px">
            <a href="${link}" target="_blank" style="display:inline-block;padding:15px 40px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px">Reset Password</a>
          </td>
        </tr></table>
        <p style="margin:0 0 22px;font-size:13px;color:#6E6A78;text-align:center">Link ini berlaku selama <strong>30 menit</strong>.</p>
        <p style="margin:0 0 8px;font-size:13px;color:#6E6A78">Jika tombol tidak berfungsi, salin dan tempel tautan berikut ke browser Anda:</p>
        <p style="margin:0 0 24px;padding:12px 14px;background:#F4F2F8;border-radius:8px;font-size:12px;word-break:break-all"><a href="${link}" style="color:#7C5CFC;text-decoration:none">${link}</a></p>
        <p style="margin:0;font-size:13px;color:#9A94A6">Jika Anda tidak meminta reset password, abaikan email ini — password Anda tidak akan berubah.</p>
      </td></tr>
      <tr><td style="padding:22px 32px;background:#FBFAFD;border-top:1px solid #E4E0EA">
        <p style="margin:0 0 4px;font-size:13px;color:#4B4858">Best regards,</p>
        <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#211A4D">PT Integra Aplikasi Artifisial (AITECH)</p>
        <p style="margin:0 0 10px;font-size:12px;color:#9A94A6">Integrated permit, project, GIS, finance &amp; field operations platform</p>
        <p style="margin:0;font-size:12px;color:#9A94A6"><a href="https://aitech-ilt.co.id" target="_blank" style="color:#7C5CFC;text-decoration:none">aitech-ilt.co.id</a></p>
        <p style="margin:12px 0 0;font-size:11px;color:#C4C0CE">© ${year} PermaTrax · AITECH. Email otomatis — mohon tidak membalas.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
        },
      });

      this.logger.log(`[AUDIT] forgotPassword requested - UserID: ${user.id}`);
    } else {
      // No account match — log without leaking the address back to the caller.
      this.logger.debug('[Auth] forgotPassword for unknown/inactive email');
    }

    return { success: true };
  }

  /**
   * Self-service password reset — step 2. Validates the single-use token, sets the
   * new password and invalidates all active sessions.
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    const invalid = () =>
      new BadRequestException('Tautan reset tidak valid atau sudah kedaluwarsa');

    const decoded = this.jwtService.decode(token) as
      | { sub?: string; purpose?: string }
      | null;
    const userId = decoded?.sub;
    if (!userId || decoded?.purpose !== 'pwreset') throw invalid();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, isActive: true },
    });
    if (!user || !user.isActive || !user.password) throw invalid();

    try {
      await this.jwtService.verifyAsync(token, {
        secret: this.resetTokenSecret(user.password),
      });
    } catch {
      throw invalid();
    }

    const sameAsOld = await verifyPassword(newPassword, user.password);
    if (sameAsOld) {
      throw new BadRequestException('Password baru tidak boleh sama dengan password lama');
    }

    const newHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: newHash,
        refreshToken: null, // invalidate all active sessions
      },
    });

    this.logger.log(`[AUDIT] resetPassword success - UserID: ${user.id}`);
    return { success: true, message: 'Password berhasil diubah. Silakan login.' };
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
