import { Test, TestingModule } from '@nestjs/testing'; // MODIFIED: full auth service suite
import { UnauthorizedException } from '@nestjs/common'; // MODIFIED: explicit exception checks
import { JwtService } from '@nestjs/jwt'; // MODIFIED: JWT mock access
import { ConfigService } from '@nestjs/config'; // MODIFIED: config mock
import { AuthService } from './auth.service'; // MODIFIED: service under test
import { PrismaService } from '../prisma/prisma.service'; // MODIFIED: prisma mock token
import { REDIS_CLIENT } from '../redis/redis.provider'; // MODIFIED: redis injection token
import { StorageService } from '../storage/storage.service'; // avatar storage dep
import { MailQueueService } from '../mail/mail-queue.service'; // password-reset mail dep
import { hashPassword, verifyPassword } from './utils/password.util'; // MODIFIED: utility roundtrip tests

describe('AuthService', () => { // MODIFIED: grouped by requested behavior blocks
  let service: AuthService; // MODIFIED: service handle
  const mockPrisma = { // MODIFIED: centralized prisma mock
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockJwt = { // MODIFIED: centralized jwt mock
    signAsync: jest.fn().mockResolvedValue('mock.jwt.token'),
  };
  const mockRedis = { // MODIFIED: redis blacklist mock
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
  const mockStorage = { // avatar storage mock
    uploadMulterFile: jest.fn().mockResolvedValue('https://files/avatar.png'),
  };
  const mockMailQueue = { // password-reset mail queue mock
    enqueue: jest.fn().mockResolvedValue(undefined),
  };
  const baseUser = { // MODIFIED: shared user fixture
    id: 'user-1',
    email: 'test@permatrax.com',
    name: 'Test User',
    role: 'ADMIN',
    fiberType: null,
    password: '',
    refreshToken: null as string | null,
    isActive: true,
  };

  beforeEach(async () => { // MODIFIED: reset mocks each test
    jest.clearAllMocks(); // MODIFIED: avoid leakage
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: StorageService, useValue: mockStorage },
        { provide: MailQueueService, useValue: mockMailQueue },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  describe('validateUser', () => { // MODIFIED: requested validateUser block
    it('returns safe user on valid credentials', async () => { // MODIFIED: positive path
      const hash = await hashPassword('ValidPass123!');
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hash });
      const result = await service.validateUser(baseUser.email, 'ValidPass123!');
      expect(result.id).toBe(baseUser.id);
      expect(result.email).toBe(baseUser.email);
      expect(result.password).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
    });

    it('throws UnauthorizedException on wrong password', async () => { // MODIFIED: wrong password
      const hash = await hashPassword('ValidPass123!');
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hash });
      await expect(service.validateUser(baseUser.email, 'WrongPass')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException on unknown email', async () => { // MODIFIED: unknown user
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.validateUser('unknown@permatrax.com', 'pass')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException("Account deactivated") when isActive=false', async () => { // MODIFIED: inactive account path
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isActive: false });
      await expect(service.validateUser(baseUser.email, 'pass')).rejects.toThrow('Account deactivated');
    });

    it('updates lastLoginAt on successful login', async () => { // MODIFIED: update tracking
      const hash = await hashPassword('ValidPass123!');
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hash });
      await service.validateUser(baseUser.email, 'ValidPass123!');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: baseUser.id },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });

    it('never returns password field in result', async () => { // MODIFIED: sensitive field check
      const hash = await hashPassword('ValidPass123!');
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hash });
      const result = await service.validateUser(baseUser.email, 'ValidPass123!');
      expect('password' in result).toBe(false);
    });

    it('never returns refreshToken field in result', async () => { // MODIFIED: sensitive field check
      const hash = await hashPassword('ValidPass123!');
      const refreshHash = await hashPassword('refresh');
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hash, refreshToken: refreshHash });
      const result = await service.validateUser(baseUser.email, 'ValidPass123!');
      expect('refreshToken' in result).toBe(false);
    });
  });

  describe('login', () => { // MODIFIED: requested login block
    it('returns accessToken, refreshToken, and user object', async () => { // MODIFIED: login payload shape
      mockPrisma.user.update.mockResolvedValue(undefined);
      const result = await service.login(baseUser);
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.id).toBe(baseUser.id);
    });

    it('JWT payload contains sub, email, role, jti', async () => { // MODIFIED: token payload check
      mockPrisma.user.update.mockResolvedValue(undefined);
      await service.login(baseUser);
      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: baseUser.id,
          email: baseUser.email,
          role: baseUser.role,
          jti: expect.any(String),
        }),
        expect.any(Object),
      );
    });

    it('accessToken expires in 8h', async () => { // MODIFIED: expiration policy check
      mockPrisma.user.update.mockResolvedValue(undefined);
      await service.login(baseUser);
      expect(mockJwt.signAsync).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ expiresIn: '8h' }));
    });

    it('stores hashed refreshToken in DB (not plain)', async () => { // MODIFIED: DB storage protection
      mockPrisma.user.update.mockResolvedValue(undefined);
      await service.login(baseUser);
      const stored = mockPrisma.user.update.mock.calls[0][0].data.refreshToken as string;
      expect(stored.startsWith('$2')).toBe(true);
    });

    it('plain refreshToken !== stored hash', async () => { // MODIFIED: hash mismatch check
      mockPrisma.user.update.mockResolvedValue(undefined);
      const loginResult = await service.login(baseUser);
      const stored = mockPrisma.user.update.mock.calls[0][0].data.refreshToken as string;
      expect(loginResult.refreshToken).not.toBe(stored);
    });
  });

  describe('refreshAccessToken', () => { // MODIFIED: requested refresh block
    it('returns new accessToken for valid refreshToken', async () => { // MODIFIED: positive refresh path
      const raw = 'refresh-valid-token';
      const hash = await hashPassword(raw);
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, refreshToken: hash });
      const result = await service.refreshAccessToken(baseUser.id, raw);
      expect(result.accessToken).toBe('mock.jwt.token');
    });

    it('throws UnauthorizedException for invalid refreshToken', async () => { // MODIFIED: invalid refresh path
      const hash = await hashPassword('different-token');
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, refreshToken: hash });
      await expect(service.refreshAccessToken(baseUser.id, 'invalid-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when no token stored in DB', async () => { // MODIFIED: null refresh token path
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, refreshToken: null });
      await expect(service.refreshAccessToken(baseUser.id, 'any-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => { // MODIFIED: requested logout block
    it('sets user.refreshToken to null in DB', async () => { // MODIFIED: DB reset assertion
      await service.logout(baseUser.id, 'jti-1', 1800);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: { refreshToken: null },
      });
    });

    it('blacklists JWT jti in Redis', async () => { // MODIFIED: redis blacklist assertion
      await service.logout(baseUser.id, 'jti-1', 1800);
      expect(mockRedis.setex).toHaveBeenCalledWith('blacklist:jti-1', 1800, '1');
    });

    it('returns success message', async () => { // MODIFIED: response assertion
      const result = await service.logout(baseUser.id, 'jti-1', 1800);
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('isTokenBlacklisted', () => { // MODIFIED: requested blacklist read block
    it('returns true for blacklisted jti', async () => { // MODIFIED: known key path
      mockRedis.get.mockResolvedValueOnce('1');
      await expect(service.isTokenBlacklisted('jti-true')).resolves.toBe(true);
    });

    it('returns false for unknown jti', async () => { // MODIFIED: unknown key path
      mockRedis.get.mockResolvedValueOnce(null);
      await expect(service.isTokenBlacklisted('jti-false')).resolves.toBe(false);
    });
  });

  describe('password utilities (via verifyPassword/hashPassword)', () => { // MODIFIED: explicit utility block
    it('hashPassword + verifyPassword roundtrip = true', async () => { // MODIFIED: utility success
      const hash = await hashPassword('Password123!');
      expect(await verifyPassword('Password123!', hash)).toBe(true);
    });

    it('wrong password = false', async () => { // MODIFIED: utility wrong pass
      const hash = await hashPassword('Password123!');
      expect(await verifyPassword('WrongPassword!', hash)).toBe(false);
    });

    it('two hashes of same password are NOT equal (salt randomness)', async () => { // MODIFIED: salt randomness
      const hash1 = await hashPassword('Password123!');
      const hash2 = await hashPassword('Password123!');
      expect(hash1).not.toBe(hash2);
    });
  });
});
