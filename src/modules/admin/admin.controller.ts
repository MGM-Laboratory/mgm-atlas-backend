import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminService } from './admin.service';
import {
  CreateCollaborationRoleDto,
  UpdateCollaborationRoleDto,
} from './dto/collaboration-role.dto';

@ApiBearerAuth()
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ─── Collaboration roles (Frontend Engineer, etc.) ────────────────────

  @Get('collaboration-roles')
  listRoles() {
    return this.admin.listRoles();
  }

  @Post('collaboration-roles')
  @UseGuards(AdminGuard)
  createRole(@Body() dto: CreateCollaborationRoleDto) {
    return this.admin.createRole(dto);
  }

  @Patch('collaboration-roles/:id')
  @UseGuards(AdminGuard)
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollaborationRoleDto,
  ) {
    return this.admin.updateRole(id, dto);
  }

  @Delete('collaboration-roles/:id')
  @UseGuards(AdminGuard)
  archiveRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.archiveRole(id);
  }
}
