import { Controller, Get, Post, Body } from '@nestjs/common';
import { ClusterService } from './cluster.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Cluster Intake')
@Controller('clusters')
export class ClusterController {
  constructor(private readonly clusterService: ClusterService) {}

  @Get()
  @ApiOperation({ summary: 'Obtain globally active infrastructural cluster bounds' })
  async findAll() {
    return this.clusterService.findAll();
  }

  @Get('spatial')
  @ApiOperation({ summary: 'Obtain strictly compliant GIS spatial cluster metrics tracking bounding constraints directly natively.' })
  async getSpatial() {
    return this.clusterService.getSpatial();
  }

  @Post()
  @ApiOperation({ summary: 'Register tracking metrics mapping abstract topology' })
  async create(@Body() createDto: any) {
    return this.clusterService.create(createDto);
  }
}
