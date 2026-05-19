import { Controller, Post, Body, Get, Param, Patch, Request } from '@nestjs/common'; // FIX: remove local UseGuards usage; rely on global APP_GUARD
import { Document } from '@permatrack/db';
import { DocumentsService } from './documents.service';
import { GenerateDocumentDto, UploadSignedDto } from './dto/generate-document.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Auto-generate compliance documentation from database schema parameters natively compiling to S3' })
  generateDocument(@Body() generateDocumentDto: GenerateDocumentDto): Promise<Document> {
    return this.documentsService.generateDocument(generateDocumentDto);
  }

  @Post('cluster/:clusterId/attachments')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Mock endpoint for legal SCOM document uplinks natively mapping PostGIS relations.' })
  async uploadAttachment(@Param('clusterId') clusterId: string, @Body() body: any, @Request() req: any) {
     const userName = req.user?.name || 'Admin SCOM';
     return this.documentsService.uploadAttachment(clusterId, body.documentType, userName);
  }

  @Post('upload-signed')
  @ApiOperation({ summary: 'Obtain AWS SDK v3 presigned S3 url for compliant frontend direct file signatures' })
  uploadSigned(@Body() uploadSignedDto: UploadSignedDto) {
    return this.documentsService.uploadSigned(uploadSignedDto);
  }

  @Get('inbox/rejected')
  @ApiOperation({ summary: 'Obtain explicitly mapped rejection tracking bounds navigating back cleanly seamlessly natively inherently' })
  async getRejectedInbox() {
     return this.documentsService.getRejectedInbox();
  }

  @Get('cluster/:clusterId')
  @ApiOperation({ summary: 'Retrieve document tracking timeline matrix for specific cluster topology' })
  async getByCluster(@Param('clusterId') clusterId: string) {
    return this.documentsService.getByCluster(clusterId);
  }

  @Patch(':id/review')
  @Roles(Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE)
  @ApiOperation({ summary: 'Admin Maker-Checker execution bounds payload validation mapping routing over REST natively.' })
  async reviewDocument(@Param('id') id: string, @Body() body: any, @Request() req: any) {
     const userRole = req.user?.role || 'ADMIN';
     const userName = req.user?.name || 'Administrator Node';
     return this.documentsService.reviewDocument(id, body, userRole, userName);
  }
}
