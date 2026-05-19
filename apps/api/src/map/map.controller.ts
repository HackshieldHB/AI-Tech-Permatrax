import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Header,
  Res,
  Req,
  Query,
} from '@nestjs/common'; // FIX: GIS + legacy map API
import { MapDrawing } from '@permatrack/db';
import { Role } from '@prisma/client'; // FIX: typed GIS roles
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { MapService } from './map.service';
import { parseMvtTilePathParams } from './map-tile-params';
import { Public } from '../auth/decorators/public.decorator'; // FIX: MVT / MapViewer tanpa JWT
import { Roles } from '../auth/decorators/roles.decorator'; // FIX: gate GIS endpoints
import { IsNumber, IsString, IsOptional, IsIn } from 'class-validator';

// FIX: DTO class so ValidationPipe allows polygon fields
class CalculateFtthDto {
  @IsNumber()
  targetLat: number;

  @IsNumber()
  targetLon: number;

  @IsNumber()
  backboneLat: number;

  @IsNumber()
  backboneLon: number;

  @IsIn(['URBAN', 'SUBURBAN', 'RURAL'])
  areaType: 'URBAN' | 'SUBURBAN' | 'RURAL';

  @IsNumber()
  areaRadiusMeters: number;

  @IsOptional()
  @IsString()
  backboneOwner?: string;

  // FIX: polygon mode — optional, skipped by whitelist
  @IsOptional()
  @IsNumber()
  polygonAreaSqM?: number;

  @IsOptional()
  @IsNumber()
  polygonCentroidLat?: number;

  @IsOptional()
  @IsNumber()
  polygonCentroidLon?: number;
}

// FIX: roles that can access GIS map API
const GIS_ROLES = [
  Role.SURVEYOR_FTTH,
  Role.SURVEYOR_FTTB,
  Role.SURVEYOR_FTTT,
  Role.PM_FTTH,
  Role.PM_FTTB,
  Role.PM_FTTT,
  Role.PM_SENIOR,
  Role.DESIGNER,
  Role.OPERATIONAL_MANAGER,
  Role.GENERAL_MANAGER,
  Role.ADMIN,
];

@ApiTags('Map')
@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Public() // FIX: tile fetch from MapLibre tanpa Authorization
  @Get('tiles/:z/:x/:y.pbf')
  @ApiOperation({ summary: 'Get MVT vectors for the Homepass layer' })
  @ApiParam({ name: 'z', type: 'number', description: 'Zoom level' })
  @ApiParam({ name: 'x', type: 'number', description: 'X tile coordinate' })
  @ApiParam({ name: 'y', type: 'number', description: 'Y tile coordinate' })
  @Header('Content-Type', 'application/x-protobuf')
  @Header('Access-Control-Allow-Origin', '*')
  async getTile(
    @Param() params: { z: string; x: string; y: string },
    @Res() res: Response,
  ) {
    const { z, x, y } = parseMvtTilePathParams(params);
    const tileBuffer = await this.mapService.getHomepassTile(z, x, y);
    if (tileBuffer.length === 0) {
      res.status(204).send();
      return;
    }
    res.send(tileBuffer);
  }

  @Public() // FIX: MapViewer analyze tanpa JWT
  @Post('analyze-cluster')
  @ApiOperation({
    summary: 'Analyze Homepasses intersected natively within a transmitted GeoJSON Polygon',
  })
  async analyzeCluster(@Body() geoJsonPolygon: unknown) {
    return this.mapService.analyzeCluster(geoJsonPolygon);
  }

  @Public() // FIX: drawings list untuk kompatibilitas MapViewer
  @Get('drawings')
  @ApiOperation({ summary: 'Extract saved geopolitical bounded arrays locally' })
  async getDrawings(@Query('limit') limit?: string): Promise<MapDrawing[]> {
    const n = limit != null ? parseInt(limit, 10) : undefined;
    return this.mapService.getDrawings(Number.isFinite(n) ? n : undefined);
  }

  @Public() // FIX: save drawing dari MapViewer
  @Post('drawings')
  @ApiOperation({
    summary: 'Transcode boundary payloads mapping geometries natively into Postgres',
  })
  async saveDrawing(
    @Body() data: { geojson: unknown; color: string },
  ): Promise<MapDrawing> {
    return this.mapService.saveDrawing(data);
  }

  @Public() // FIX: delete drawing dari MapViewer
  @Delete('drawings/:id')
  @ApiOperation({ summary: 'Erase boundary polygons exclusively bounding map logic' })
  async deleteDrawing(@Param('id') id: string): Promise<MapDrawing> {
    return this.mapService.deleteDrawing(id);
  }

  // FIX: Get permit clusters for map (bbox + limit — Sprint 2 performance)
  @Get('clusters')
  @Roles(...GIS_ROLES)
  async getClusters(@Query('bbox') bbox?: string, @Query('limit') limit?: string) {
    const n = limit != null ? parseInt(limit, 10) : undefined;
    return this.mapService.getPermitClusters(bbox ?? null, Number.isFinite(n) ? n : undefined);
  }

  // FIX: Update cluster pin location
  @Patch('clusters/:id/coordinates')
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
  )
  async updateCoordinates(
    @Param('id') id: string,
    @Body()
    body: {
      latitude: number;
      longitude: number;
      rwName?: string;
    },
  ) {
    return this.mapService.updateClusterCoordinates(id, body);
  }

  // FIX: KMZ layers — bounded list
  @Get('layers')
  @Roles(...GIS_ROLES)
  async getLayers(@Query('limit') limit?: string) {
    const n = limit != null ? parseInt(limit, 10) : undefined;
    return this.mapService.getGisLayers(Number.isFinite(n) ? n : undefined);
  }

  // FIX: Save KMZ layer (GeoJSON dari frontend)
  @Post('layers')
  @Roles(
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.DESIGNER,
    Role.ADMIN,
  )
  async saveLayer(
    @Body()
    body: {
      name: string;
      fileUrl: string;
      geoJson: unknown;
      color?: string;
    },
    @Req() req: { user: { userId: string } },
  ) {
    return this.mapService.saveGisLayer(body, req.user.userId);
  }

  // FIX: Toggle layer visibility
  @Patch('layers/:id/visibility')
  @Roles(...GIS_ROLES)
  async toggleLayer(
    @Param('id') id: string,
    @Body() body: { isVisible: boolean },
  ) {
    return this.mapService.toggleGisLayer(id, body.isVisible);
  }

  // FIX: Delete KMZ layer — Designer + semua PM boleh hapus (bukan hanya Admin / PM Senior)
  @Delete('layers/:id')
  @Roles(
    Role.ADMIN, // FIX
    Role.PM_FTTH, // FIX: PM dapat hapus layer KMZ
    Role.PM_FTTB, // FIX
    Role.PM_FTTT, // FIX
    Role.PM_SENIOR, // FIX
    Role.DESIGNER, // FIX: Designer dapat hapus layer KMZ
  )
  async deleteLayer(@Param('id') id: string) {
    return this.mapService.deleteGisLayer(id); // FIX
  }

  // FIX: Proxy Overpass API (hindari CORS browser)
  @Get('fiber-backbone')
  @Roles(...GIS_ROLES)
  async getFiberBackbone(
    @Query('lat') lat: string,
    @Query('lon') lon: string,
    @Query('radius') radius?: string,
  ) {
    return this.mapService.getFiberBackbone(
      parseFloat(lat),
      parseFloat(lon),
      radius ? parseInt(radius, 10) : 5000,
    );
  }

  // FIX: POST /map/route — road-following route proxy (OSRM → Valhalla → straight line)
  @Post('route')
  @Roles(...GIS_ROLES)
  async getRoute(
    @Body()
    body: {
      fromLng: number;
      fromLat: number;
      toLng: number;
      toLat: number;
      profile?: 'driving' | 'walking';
    },
  ) {
    return this.mapService.getRoute(
      body.fromLng,
      body.fromLat,
      body.toLng,
      body.toLat,
      body.profile || 'driving',
    );
  }

  // FIX: POST /map/snap — snap point to nearest road (OSRM nearest)
  @Post('snap')
  @Roles(...GIS_ROLES)
  async snapToRoad(@Body() body: { lng: number; lat: number }) {
    return this.mapService.snapPointToRoad(body.lng, body.lat);
  }

  // FIX: GET /map/buildings — OSM buildings in radius (Overpass)
  @Get('buildings')
  @Roles(...GIS_ROLES)
  async getBuildings(
    @Query('lat') lat: string,
    @Query('lon') lon: string,
    @Query('radius') radius?: string,
  ) {
    return this.mapService.getBuildings(
      parseFloat(lat),
      parseFloat(lon),
      radius ? Math.min(parseInt(radius, 10), 2000) : 500,
    );
  }

  // FIX: POST /map/multi-route — batch routing in 1 OSRM call
  @Post('multi-route')
  @Roles(...GIS_ROLES)
  async getMultiRoute(
    @Body()
    body: {
      waypoints: Array<[number, number]>;
      profile?: 'driving' | 'walking';
    },
  ) {
    return this.mapService.getMultiRoute(body.waypoints, body.profile || 'driving'); // FIX
  }

  @Post('calculate')
  @Roles(...GIS_ROLES)
  async calculate(@Body() body: CalculateFtthDto) {
    return this.mapService.calculateFtthNetwork(body);
  }
}
