import { Controller, Get, Post, Param, Query, Body, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // FIX: FILE_BASE_URL → correct public API host for signed download links
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { Role } from '@prisma/client'; // FIX: tight role set on POST /ba-open
import { BaOpenService } from './ba-open.service';
import { BaOpenListFilterDto, CreateBaOpenDto } from './ba-open.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { DownloadTokenService } from '../common/services/download-token.service'; // FIX: HMAC signed URLs

// NEW: BaOpenController — serves BA Open documents
@ApiTags('BA Open')
@Controller('ba-open')
export class BaOpenController {
  constructor(
    private readonly baOpenService: BaOpenService,
    private readonly downloadTokenService: DownloadTokenService, // FIX: HMAC token generator/verifier
    private readonly configService: ConfigService, // FIX: resolve API base for signed URLs (ngrok / FILE_BASE_URL)
  ) {}

  // FIX: must be before :id routes — lookup by visit request (null if not created yet)
  @Get('by-visit-request/:visitRequestId')
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'BA Open by visit request id (null if belum dibuat)' })
  async findByVisitRequest(@Param('visitRequestId') visitRequestId: string) {
    const baOpen = await this.baOpenService.findByVisitRequestId(visitRequestId);
    return { baOpen }; // FIX: explicit JSON — avoids ambiguous empty body
  }

  // FIX: lookup via permit cluster
  @Get('by-cluster/:clusterId')
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'BA Open by permit cluster id' })
  async findByCluster(@Param('clusterId') clusterId: string) {
    const baOpen = await this.baOpenService.findByClusterId(clusterId);
    return { baOpen };
  }

  // NEW: GET /api/ba-open — list all with filters
  @Get()
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'List semua dokumen BA Open' })
  async findAll(@Query() query: Record<string, unknown>) {
    const filters = BaOpenListFilterDto.parse(query);
    return this.baOpenService.findAll(filters);
  }

  // NEW: POST /api/ba-open — manual create (administrative)
  @Post()
  @Roles( // FIX: tighter roles — only surveyor + PM chain + Admin can create BA Open (not GM/viewer set)
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Buat BA Open dari form 4 field wajib' })
  async create(@Body() body: Record<string, unknown>, @Req() req: any) {
    const dto = CreateBaOpenDto.parse(body);
    return this.baOpenService.generateBaOpen(dto, req.user.userId);
  }

  // FIX: authenticated endpoint — hand out signed, short-lived download URL
  @Get(':id/download-url')
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'Issue signed download URL (1h TTL) for BA Open PDF' })
  async getDownloadUrl(@Param('id') id: string) {
    const token = this.downloadTokenService.generate(id, 3600);
    const port = this.configService.get<string>('PORT') || '3001'; // FIX: match Nest listen port when FILE_BASE_URL unset
    const fileBaseUrl =
      this.configService.get<string>('FILE_BASE_URL') ||
      `http://localhost:${port}/api/files`; // FIX: same default shape as storage service
    const origin = fileBaseUrl.replace(/\/?api\/files\/?$/i, '').replace(/\/?files\/?$/i, ''); // FIX: strip “/api/files” (or “/files”) → API origin only
    const url = `${origin}/api/ba-open/${id}/download?token=${encodeURIComponent(token)}`; // FIX: always target API /api/ba-open, never the Next.js dev server
    return {
      url,
      expiresIn: 3600,
    };
  }

  // FIX: download — redirect to stored PDF or stream generated buffer (no 404 when PDF pending)
  @Get(':id/download')
  @Public() // FIX: allow <a href> / window.open without Authorization header (browser downloads)
  @ApiOperation({ summary: 'Download PDF BA Open — signed token required when provided' })
  async download(
    @Param('id') id: string,
    @Query('token') token: string | undefined, // FIX: optional signed token — when present it MUST verify
    @Res({ passthrough: false }) res: Response,
  ) {
    // FIX: if token supplied, verify it; if missing, keep legacy obscurity-only path (to be phased out)
    if (token) {
      const valid = this.downloadTokenService.verify(token, id);
      if (!valid) {
        throw new UnauthorizedException('Download link expired or invalid. Please request a new one.');
      }
    }
    const result = await this.baOpenService.resolveDownload(id);
    if (result.mode === 'redirect') {
      return res.redirect(302, result.url);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  }

  // NEW: GET /api/ba-open/:id — single detail
  @Get(':id')
  @Roles(...PERMISSIONS.BA_OPEN_VIEW)
  @ApiOperation({ summary: 'Detail satu BA Open' })
  async findOne(@Param('id') id: string) {
    return this.baOpenService.findOne(id);
  }

  // NEW: POST /api/ba-open/:id/send-to-isp — mark as sent and email ISP
  @Post(':id/send-to-isp')
  @Roles(...PERMISSIONS.DOC_EMAIL_SEND)
  @ApiOperation({ summary: 'Kirim BA Open ke ISP via email' })
  async sendToIsp(@Param('id') id: string, @Req() req: any) {
    return this.baOpenService.sendToIsp(id, req.user.userId);
  }
}
