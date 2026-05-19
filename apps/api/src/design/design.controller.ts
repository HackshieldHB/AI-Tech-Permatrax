import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { PERMISSIONS } from '../auth/permissions';
import type { AuthUser } from '../auth/types/auth-user.types';
import { CreateDesignSchema } from './dto/create-design.dto';
import { CreateDesignEdgeSchema, PatchDesignEdgeSchema } from './dto/design-edge-mutation.dto';
import { CreateDesignNodeSchema, PatchDesignNodeSchema } from './dto/design-node-mutation.dto';
import { ListDesignsQuerySchema } from './dto/list-designs.dto';
import { UpdateDesignSchema } from './dto/update-design.dto';
import { DesignService } from './design.service';

/**
 * Authorization model (Phase 1):
 *
 * Endpoints are gated by @Roles(...PERMISSIONS.NETWORK_DESIGN) only. There is
 * no project-level authorization — any authenticated user with NETWORK_DESIGN
 * permission may create, read, list, or archive designs against any projectId.
 *
 * This is consistent with MapController's role-only model (e.g. POST /map/calculate)
 * and reflects the current data model: Project has no membership concept
 * (no ProjectMember table, no ownerId). The `createdBy` field on NetworkDesign
 * provides an audit trail.
 *
 * If project membership is introduced later (e.g. a ProjectMember table or
 * Project ↔ PermitCluster link), this controller should adopt resource-level
 * checks similar to ApdAbdService.loadCluster:
 * - findOneByIdWithGeometry: verify user can read project
 * - createFromCalc: verify user can write to project
 * - archiveDesign: verify user can write to project (or is creator)
 * - listByProject: filter results to projects the user can read
 *
 * See: apps/api/src/apd-abd/apd-abd.service.ts (loadCluster pattern)
 *      apps/api/src/permit-cluster/permit-cluster.service.ts
 */
@ApiTags('Network design')
@Controller('design')
export class DesignController {
  constructor(private readonly designService: DesignService) {}

  @Post()
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Persist calc topology as draft design' })
  create(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const parsed = CreateDesignSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.designService.createFromCalc(parsed.data, req.user.userId);
  }

  @Get()
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'List designs for a project' })
  list(
    @Query() query: any,
    @Req() req: Request & { user: AuthUser },
  ) {
    const parsed = ListDesignsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    // FIX 2: Filter by current user's ID so users only see their own drafts
    return this.designService.listByProject({
      ...parsed.data,
      createdBy: req.user.userId,
    });
  }

  @Get(':id')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Design detail with GeoJSON geometry' })
  getOne(@Param('id') id: string) {
    return this.designService.findOneByIdWithGeometry(id);
  }

  @Patch(':id')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Update design geometry and sketch topology' })
  update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateDesignSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.designService.update(id, parsed.data);
  }

  @Delete(':id')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Archive design (soft delete)' })
  archive(@Param('id') id: string) {
    return this.designService.archiveDesign(id);
  }

  @Post(':designId/nodes')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Add one node to an existing design' })
  createNode(@Param('designId') designId: string, @Body() body: unknown) {
    const parsed = CreateDesignNodeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.designService.createNode(designId, parsed.data);
  }

  @Patch(':designId/nodes/:refId')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Update one node in an existing design' })
  updateNode(
    @Param('designId') designId: string,
    @Param('refId') refId: string,
    @Body() body: unknown,
  ) {
    const parsed = PatchDesignNodeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.designService.updateNode(designId, refId, parsed.data);
  }

  @Delete(':designId/nodes/:refId')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Delete node and connected edges in one transaction' })
  deleteNode(@Param('designId') designId: string, @Param('refId') refId: string) {
    return this.designService.deleteNode(designId, refId);
  }

  @Post(':designId/edges')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Add one edge to an existing design' })
  createEdge(@Param('designId') designId: string, @Body() body: unknown) {
    const parsed = CreateDesignEdgeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.designService.createEdge(designId, parsed.data);
  }

  @Patch(':designId/edges/:refId')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Update one edge in an existing design' })
  updateEdge(
    @Param('designId') designId: string,
    @Param('refId') refId: string,
    @Body() body: unknown,
  ) {
    const parsed = PatchDesignEdgeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.designService.updateEdge(designId, refId, parsed.data);
  }

  @Delete(':designId/edges/:refId')
  @Roles(...PERMISSIONS.NETWORK_DESIGN)
  @ApiOperation({ summary: 'Delete one edge from an existing design' })
  deleteEdge(@Param('designId') designId: string, @Param('refId') refId: string) {
    return this.designService.deleteEdge(designId, refId);
  }
}
