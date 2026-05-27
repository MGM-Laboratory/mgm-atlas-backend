import {
  Body,
  Controller,
  Delete,
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
import {
  ProjectAccess,
  ProjectAccessService,
} from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/// After assertInsider() the access level is guaranteed to be one of
/// these three; the other two ('viewer', 'guest') would have thrown.
type InsiderKind = 'admin' | 'manager' | 'contributor';
function asInsiderKind(access: ProjectAccess): InsiderKind {
  return access.level as InsiderKind;
}

@ApiBearerAuth()
@ApiTags('pmo:tasks')
@UseGuards(PmoFeatureFlagGuard)
@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:slug/task-lists/:listId/tasks')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.list(projectId, listId, query);
  }

  @Get('projects/:slug/tasks/key/:key')
  async getByKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('key') key: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.getByKey(projectId, key);
  }

  @Get('projects/:slug/tasks/:taskId')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.get(projectId, taskId);
  }

  @Get('projects/:slug/tasks/:taskId/activity')
  async activity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.listActivity(projectId, taskId);
  }

  @Post('projects/:slug/task-lists/:listId/tasks')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: CreateTaskDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.create(user, asInsiderKind(access), projectId, listId, dto);
  }

  @Patch('projects/:slug/tasks/:taskId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.update(user, asInsiderKind(access), projectId, taskId, dto);
  }

  @Patch('projects/:slug/tasks/:taskId/position')
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: MoveTaskDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.move(user, asInsiderKind(access), projectId, taskId, dto);
  }

  @Post('projects/:slug/tasks/:taskId/archive')
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.archive(user, asInsiderKind(access), projectId, taskId);
  }

  @Post('projects/:slug/tasks/:taskId/unarchive')
  async unarchive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.unarchive(user, asInsiderKind(access), projectId, taskId);
  }

  @Delete('projects/:slug/tasks/:taskId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.tasks.softDelete(user, asInsiderKind(access), projectId, taskId);
  }
}
