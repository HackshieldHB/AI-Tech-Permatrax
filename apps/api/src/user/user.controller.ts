import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserService } from './user.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  CreateUserSchema,
  UpdateUserSchema,
  ChangePasswordSchema,
  UserListFilterSchema,
} from './user.dto';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('stats')
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: allow Admin to view user stats
  @ApiOperation({ summary: 'Statistik user untuk GM dashboard' })
  async stats() {
    return this.userService.getUserStats();
  }

  @Get()
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can list users
  @ApiOperation({ summary: 'Daftar user dengan filter' })
  async findAll(@Query() query: Record<string, unknown>) {
    const filters = UserListFilterSchema.parse(query);
    return this.userService.findAll(filters);
  }

  @Get(':id')
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can view user detail
  @ApiOperation({ summary: 'Detail user' })
  async findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Post()
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can create users (Tambah User)
  @ApiOperation({ summary: 'Buat user baru' })
  async create(@Body() body: unknown, @Req() req: any) {
    const dto = CreateUserSchema.parse(body);
    return this.userService.create(dto, req.user.userId);
  }

  @Patch(':id')
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can update users
  @ApiOperation({ summary: 'Update user' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UpdateUserSchema.parse(body);
    return this.userService.update(id, dto, req.user.userId);
  }

  @Post(':id/change-password')
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can reset passwords
  @ApiOperation({ summary: 'Reset password user' })
  async changePassword(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const dto = ChangePasswordSchema.parse(body);
    return this.userService.changePassword(id, dto, req.user.userId);
  }

  @Post(':id/deactivate')
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can deactivate users
  @ApiOperation({ summary: 'Nonaktifkan user' })
  async deactivate(@Param('id') id: string, @Req() req: any) {
    return this.userService.deactivate(id, req.user.userId);
  }

  @Post(':id/reactivate')
  @Roles(Role.GENERAL_MANAGER, Role.ADMIN) // FIX Issue 9: Admin can reactivate users
  @ApiOperation({ summary: 'Aktifkan kembali user' })
  async reactivate(@Param('id') id: string, @Req() req: any) {
    return this.userService.reactivate(id, req.user.userId);
  }
}
