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
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { TaskCommentsService } from './task-comments.service';

type InsiderKind = 'admin' | 'manager' | 'contributor';
function asInsiderKind(access: ProjectAccess): InsiderKind {
  return access.level as InsiderKind;
}

@ApiBearerAuth()
@ApiTags('pmo:task-comments')
@UseGuards(PmoFeatureFlagGuard)
@Controller()
export class TaskCommentsController {
  constructor(
    private readonly comments: TaskCommentsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:slug/tasks/:taskId/comments')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query() query: ListCommentsQueryDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.comments.list(projectId, taskId, query.page, query.pageSize);
  }

  @Post('projects/:slug/tasks/:taskId/comments')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.comments.create(user, projectId, taskId, dto);
  }

  @Patch('projects/:slug/task-comments/:commentId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.comments.update(user, asInsiderKind(access), projectId, commentId, dto);
  }

  @Delete('projects/:slug/task-comments/:commentId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.comments.softDelete(user, asInsiderKind(access), projectId, commentId);
  }
}
