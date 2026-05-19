import { Controller, Post, Param, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SignatureService } from './signature.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('Signatures')
@Controller('signatures')
export class SignatureValidateController {
  constructor(private readonly signatureService: SignatureService) {}

  @Post(':id/validate')
  @Roles(...PERMISSIONS.SIGNATURE_VALIDATE)
  @ApiOperation({ summary: 'Validasi KTP vs tanda tangan' })
  async validate(
    @Param('id') id: string,
    @Body() body: { action: 'VALID' | 'INVALID'; reason?: string },
    @Req() req: any,
  ) {
    return this.signatureService.validateSignature(id, body.action, body.reason, req.user.userId);
  }
}
