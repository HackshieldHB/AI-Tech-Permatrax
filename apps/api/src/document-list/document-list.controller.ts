import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'; // FIX: Nest imports
import { ApiTags, ApiOperation } from '@nestjs/swagger'; // FIX: swagger
import { DocumentListService } from './document-list.service'; // FIX: service
import { Roles } from '../auth/decorators/roles.decorator'; // FIX: RBAC
import { PERMISSIONS } from '../auth/permissions'; // FIX: permissions
import { DocumentListFilterDto } from './document-list.dto'; // FIX: list filters

@ApiTags('Document list') // FIX: tag
@Controller('document-list') // FIX: path
export class DocumentListController {
  constructor(private readonly documentListService: DocumentListService) {} // FIX: DI

  @Get() // FIX: legacy paginated list
  @Roles(...PERMISSIONS.DOCUMENT_LIST_VIEW) // FIX: viewers
  @ApiOperation({ summary: 'Daftar cluster (paginasi)' }) // FIX: doc
  async list(@Query() query: Record<string, unknown>) {
    const filters = DocumentListFilterDto.parse(query); // FIX: parse
    return this.documentListService.getAllCompletedClusters(filters); // FIX
  }

  @Get('grouped') // FIX: MUST be before :clusterId
  @Roles(...PERMISSIONS.DOCUMENT_LIST_VIEW) // FIX: viewers
  @ApiOperation({ summary: 'Cluster dikelompokkan per ISP' }) // FIX: doc
  async getGrouped(
    @Query('search') search?: string, // FIX: search
    @Query('fiberType') fiberType?: string, // FIX: fiber
    @Query('isp') ispFilter?: string, // FIX: isp
    @Query('bakpIspApproved') bakpIspApproved?: string, // FIX
    @Query('page') page?: string, // FIX: page
    @Query('limit') limit?: string, // FIX: limit
  ) {
    return this.documentListService.getGroupedByIsp({
      search, // FIX
      fiberType, // FIX
      ispFilter, // FIX
      bakpIspApproved: bakpIspApproved === 'true',
      page: page ? parseInt(page, 10) : 1, // FIX
      limit: limit ? parseInt(limit, 10) : 50, // FIX
    }); // FIX
  }

  @Get(':clusterId') // FIX: detail
  @Roles(...PERMISSIONS.DOCUMENT_LIST_VIEW) // FIX: viewers
  @ApiOperation({ summary: 'Semua dokumen per fase untuk satu cluster' }) // FIX: doc
  async one(@Param('clusterId') clusterId: string) {
    return this.documentListService.getDocumentListForCluster(clusterId); // FIX
  }

  @Post(':clusterId/send-to-isp') // FIX: email
  @Roles(...PERMISSIONS.DOCUMENT_EMAIL_SEND) // FIX: senders
  @ApiOperation({ summary: 'Kirim ringkasan dokumen ke email ISP (SMTP)' }) // FIX: doc
  async send(
    @Param('clusterId') clusterId: string, // FIX: id
    @Body() body: { message?: string; subject?: string }, // FIX: optional body
    @Req() req: { user: { userId: string } }, // FIX: auth
  ) {
    return this.documentListService.generateEmailToIsp(clusterId, req.user.userId, {
      message: body?.message, // FIX
      subject: body?.subject, // FIX
    }); // FIX
  }
}
