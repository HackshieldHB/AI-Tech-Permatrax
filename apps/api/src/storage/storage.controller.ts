import {
  BadRequestException,
  Controller,
  ForbiddenException, // FIX: thrown when role cannot upload to a restricted prefix
  Post,
  Get,
  Query,
  Req,                 // FIX: access authenticated user for key-path validation
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';          // FIX: enum source of truth for @Roles()
import { StorageService } from './storage.service';
import { Roles } from '../auth/decorators/roles.decorator'; // FIX: enforce role on upload/presign
import * as path from 'path';

// FIX: restrict upload to roles that legitimately need it (no MARKETING wildcard)
const UPLOAD_ALLOWED_ROLES = [
  Role.DESIGNER, // FIX: Designer uploads HLD/LLD files — was missing, caused "Akses ditolak" on /storage/upload
  Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
  Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
  Role.ADMIN, Role.ADMIN_STOCK,
  Role.GENERAL_MANAGER, Role.OPERATIONAL_MANAGER,
  Role.FINANCE,
  Role.MARKETING, Role.MARKETING_HEAD,
] as const;

// FIX: per-prefix allow-list — stops marketing/surveyors overwriting PKS, invoices, etc.
const RESTRICTED_PREFIXES: Record<string, readonly Role[]> = {
  'sip/':        [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT],
  'hld/':        [Role.DESIGNER, Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT], // FIX: Designer is primary HLD uploader
  'lld/':        [Role.DESIGNER, Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT], // FIX: Designer is primary LLD uploader
  'contract/':   [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.GENERAL_MANAGER, Role.OPERATIONAL_MANAGER], // FIX PR/BR→PO flow: PM + Admin upload PR/BR/PO here
  'invoice/':    [Role.ADMIN, Role.FINANCE, Role.PM_SENIOR],
  'bakp/':       [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, Role.FINANCE],
  'bak/':        [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT],
  'claim/':      [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT],
  'ba-open/':    [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT],
  'ba-survey/':  [Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT],
  'surat-jalan/': [Role.ADMIN, Role.ADMIN_STOCK, Role.PM_SENIOR],
};

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  // FIX: validate key path — stop traversal, stop wrong-role overwrites of critical docs
  private validateUploadKey(key: string, userRole: Role | string): void {
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('Invalid file path');
    }
    // FIX: path-traversal guard — reject `..`, `//`, absolute paths, backslash tricks
    if (key.includes('..') || key.includes('//') || key.startsWith('/') || key.includes('\\')) {
      throw new BadRequestException('Invalid file path');
    }

    for (const [prefix, allowedRoles] of Object.entries(RESTRICTED_PREFIXES)) {
      if (key.startsWith(prefix) && !allowedRoles.includes(userRole as Role)) {
        throw new ForbiddenException(`Role ${userRole} cannot upload to ${prefix}`);
      }
    }
  }

  @Post('upload')
  @Roles(...UPLOAD_ALLOWED_ROLES) // FIX: block anonymous-authenticated upload + non-authorised roles
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('key') key: string,
    @Req() req: any, // FIX: read authenticated user for per-prefix role enforcement
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!key) {
      const year = new Date().getFullYear();
      key = `general/${year}/${Date.now()}-${file.originalname}`;
      const ext = path.extname(file.originalname) || '.bin';
      void ext;
    }

    // FIX: enforce key-path policy against user role before touching disk
    this.validateUploadKey(key, req.user?.role);

    const url = await this.storageService.uploadBuffer(
      file.buffer,
      key,
      file.mimetype,
    );

    return {
      url,
      key,
      size: file.size,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  }

  @Get('presigned')
  @Roles(...UPLOAD_ALLOWED_ROLES) // FIX: same role set for presigned URL generation
  async getPresignedUrl(
    @Query('fileName') fileName: string,
    @Query('contentType') contentType: string,
    @Query('module') module: string = 'general',
    @Query('subfolder') subfolder?: string,
    @Req() req?: any, // FIX: validate generated key against user role
  ) {
    const year = new Date().getFullYear();
    const ext = path.extname(fileName) || '';
    const key = subfolder
      ? `${module}/${year}/${subfolder}/${Date.now()}${ext}`
      : `${module}/${year}/${Date.now()}${ext}`;

    // FIX: same policy as direct upload so presigned URL cannot bypass restrictions
    this.validateUploadKey(key, req?.user?.role);

    return this.storageService.generatePresignedUploadUrl(key, contentType);
  }
}
