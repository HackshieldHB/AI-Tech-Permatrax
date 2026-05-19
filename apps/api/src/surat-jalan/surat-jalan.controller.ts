import { Controller, Get, Post, Body, Param, Query, Req, Res, UnauthorizedException, NotFoundException } from '@nestjs/common'; // FIX: NotFound for by-order
import type { Response } from 'express'; // FIX: Express response type for redirect
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SuratJalanService } from './surat-jalan.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ConfirmReceiptDto } from '../order/order.dto';
import { SuratJalanFilterDto } from './surat-jalan.dto';
import { DownloadTokenService } from '../common/services/download-token.service'; // FIX: HMAC signed URLs

// NEW: SuratJalanController — delivery document viewer and receipt confirmation
@ApiTags('Surat Jalan')
@Controller('surat-jalan')
export class SuratJalanController {
  constructor(
    private readonly suratJalanService: SuratJalanService,
    private readonly downloadTokenService: DownloadTokenService, // FIX: HMAC token generator/verifier
  ) {}

  // NEW: GET /api/surat-jalan — paginated list with filters
  @Get()
  @Roles(...PERMISSIONS.SURAT_JALAN_VIEW)
  @ApiOperation({ summary: 'List semua surat jalan' })
  async findAll(@Query() query: Record<string, unknown>) {
    const filters = SuratJalanFilterDto.parse(query);
    return this.suratJalanService.findAll(filters);
  }

  // FIX: unduh PDF via API (fetch+blob) — hindari Origin: null + preflight ke /api/files
  @Get('by-order/:orderId/download')
  @Roles(...PERMISSIONS.SURAT_JALAN_VIEW)
  @ApiOperation({ summary: 'Stream PDF Surat Jalan untuk Order (attachment)' })
  async downloadByOrder(
    @Param('orderId') orderId: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const sjId = await this.suratJalanService.findSuratJalanIdByOrderId(orderId); // FIX
    if (!sjId) throw new NotFoundException('Surat jalan tidak ditemukan untuk order ini'); // FIX
    await this.suratJalanService.streamPdfFileToResponse(sjId, res); // FIX
  }

  // FIX: authenticated stream by SJ id (alternatif ke redirect publik bertoken)
  @Get(':id/download-file')
  @Roles(...PERMISSIONS.SURAT_JALAN_VIEW)
  @ApiOperation({ summary: 'Stream PDF Surat Jalan by id (attachment, JWT)' })
  async downloadFileAuthed(
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    await this.suratJalanService.streamPdfFileToResponse(id, res); // FIX
  }

  // FIX: authenticated endpoint — hand out signed, short-lived URL
  @Get(':id/download-url')
  @Roles(...PERMISSIONS.SURAT_JALAN_VIEW)
  @ApiOperation({ summary: 'Issue signed download URL (1h TTL) for Surat Jalan PDF' })
  async getDownloadUrl(@Param('id') id: string) {
    const token = this.downloadTokenService.generate(id, 3600);
    const apiBase =
      process.env.FILE_BASE_URL?.replace(/\/files$/, '') ||
      `http://localhost:${process.env.PORT || 3001}/api`;
    return {
      url: `${apiBase}/surat-jalan/${id}/download?token=${encodeURIComponent(token)}`,
      expiresIn: 3600,
    };
  }

  // NEW: GET /api/surat-jalan/:id/download — redirect ke /api/files/... (bukan JSON kosong)
  @Get(':id/download')
  @Public() // FIX: direct PDF/open link must not require Authorization header
  @ApiOperation({ summary: 'Download PDF — HTTP redirect ke file statis setelah verifikasi token' })
  async download(
    @Param('id') id: string,
    @Query('token') token: string | undefined, // FIX: HMAC token dari /download-url
    @Res() res: Response, // FIX: kita kirim 302, bukan JSON
  ) {
    if (token) { // FIX: wajib token dari link yang ditandatangani
      const valid = this.downloadTokenService.verify(token, id);
      if (!valid) {
        throw new UnauthorizedException('Download link expired or invalid. Please request a new one.');
      }
    }
    const pdfUrl = await this.suratJalanService.ensureDownloadablePdfUrl(id); // FIX: regenerate OUT jika file hilang
    return res.redirect(302, pdfUrl); // FIX: browser membuka PDF langsung
  }

  // NEW: GET /api/surat-jalan/:id — single doc with full relations
  @Get(':id')
  @Roles(...PERMISSIONS.SURAT_JALAN_VIEW)
  @ApiOperation({ summary: 'Detail surat jalan' })
  async findOne(@Param('id') id: string) {
    return this.suratJalanService.findOne(id);
  }

  // NEW: POST /api/surat-jalan/:id/confirm-receipt — ADMIN_STOCK confirms receipt
  @Post(':id/confirm-receipt')
  @Roles(...PERMISSIONS.SURAT_JALAN_CONFIRM)
  @ApiOperation({ summary: 'ADMIN_STOCK mengkonfirmasi penerimaan barang — memperbarui stok' })
  async confirmReceipt(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ConfirmReceiptDto.parse({ suratJalanId: id, ...body as object });
    return this.suratJalanService.confirmReceipt(dto, req.user.userId);
  }
}
