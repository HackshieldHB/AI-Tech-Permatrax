import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // FIX: dedicated logger for authn decisions — no payload dumps, no secrets
  private readonly logger = new Logger('JwtStrategy');

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    // FIX: block revoked tokens on EVERY request (checked against Redis blacklist)
    if (payload?.jti) {
      const isBlacklisted = await this.authService.isTokenBlacklisted(payload.jti);
      if (isBlacklisted) {
        this.logger.warn(`[Auth] Revoked token used: user=${payload.sub}`);
        throw new UnauthorizedException('Token has been revoked — please login again');
      }
    }

    // FIX: ensure the user still exists and is active — defends against deleted/disabled accounts
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true, fiberType: true },
    });

    if (!user) {
      this.logger.warn(`[Auth] Token for missing user: ${payload?.sub}`);
      throw new UnauthorizedException('User not found');
    }

    if (user.isActive === false) {
      this.logger.warn(`[Auth] Token for deactivated user: ${user.id}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    // FIX: trust DB for role/fiberType — JWT payload may be stale after GM role change
    return {
      userId: payload.sub,
      email: user.email ?? payload.email,
      role: user.role,
      jti: payload.jti,
      fiberType: user.fiberType,
      exp: payload.exp,
    };
  }
}
