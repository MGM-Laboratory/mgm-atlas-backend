import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';

class SetFeaturedDto {
  projectIds!: string[];
}

@ApiBearerAuth()
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProjectsDto) {
    return this.projects.list(user, query);
  }

  @Get('discover')
  discover(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.discover(user);
  }

  @Get('featured')
  featured() {
    return this.projects.listFeatured();
  }

  @Post('featured')
  @UseGuards(AdminGuard)
  setFeatured(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetFeaturedDto) {
    return this.projects.setFeatured(user.id, dto.projectIds ?? []);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Get(':slug')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    const { projectId, access } = await this.access.resolve(slug, user);
    return this.projects.findOne(projectId, access, user.id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const { access } = await this.access.resolve(id, user);
    this.access.assertManager(access);
    return this.projects.update(id, dto);
  }

  @Post(':id/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const { access } = await this.access.resolve(id, user);
    this.access.assertManager(access);
    return this.projects.archive(id);
  }

  @Post(':id/unarchive')
  async unarchive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const { access } = await this.access.resolve(id, user);
    this.access.assertManager(access);
    return this.projects.unarchive(id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const { access } = await this.access.resolve(id, user);
    if (access.level !== 'admin' && access.level !== 'manager') {
      throw new ForbiddenException('Only Project Managers or Admins may delete a project.');
    }
    return this.projects.softDelete(id);
  }
}
