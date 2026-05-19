import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module'; // FIX: Add Redis module explicitly
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    RedisModule, // FIX: Implicit provision explicitly guaranteed 
    PrismaModule,
    StorageModule,
    PassportModule.register({ defaultStrategy: 'jwt' }), // FIX: Configure default passport strategy
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          // FIX: explicitly hard-throw if undefined
          throw new Error('JWT_SECRET is not defined');
        }
        return {
          secret: secret,
          signOptions: { expiresIn: '8h', issuer: 'permatrax-api' }, // FIX: Hardcoded issuer and 8h strict expiration
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy], // FIX: Inject all strategies
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
