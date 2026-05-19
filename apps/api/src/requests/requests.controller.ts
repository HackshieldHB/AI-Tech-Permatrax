import { Controller, Post, Body, Patch, Param } from '@nestjs/common'; // FIX: remove local UseGuards usage; rely on global APP_GUARD
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@permatrack/db';

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new request and trigger SLA chronometer' })
  create(@Body() createRequestDto: CreateRequestDto) {
    return this.requestsService.create(createRequestDto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve request and cancel SLA jobs' })
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN)
  approve(@Param('id') id: string) {
    return this.requestsService.approve(id);
  }
}
