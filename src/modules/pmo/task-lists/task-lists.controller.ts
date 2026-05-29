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
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { BulkUpdateStatusesDto } from '../tasks/dto/bulk-update-statuses.dto';
import { CreateEmbedTabDto } from './dto/create-embed-tab.dto';
import { CreateTaskListDto } from './dto/create-task-list.dto';
import { ReorderTabsDto } from './dto/reorder-tabs.dto';
import { ReorderTaskListsDto } from './dto/reorder-task-lists.dto';
import { UpdateTaskListDto } from './dto/update-task-list.dto';
import { TaskListsService } from './task-lists.service';

@ApiBearerAuth()
@ApiTags('pmo:task-lists')
@UseGuards(PmoFeatureFlagGuard)
@Controller()
export class TaskListsController {
  constructor(
    private readonly lists: TaskListsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:slug/task-lists')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.lists.list(projectId);
  }

  @Get('projects/:slug/task-lists/:listId')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.lists.get(projectId, listId);
  }

  @Post('projects/:slug/task-lists')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateTaskListDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.create(projectId, dto);
  }

  @Patch('projects/:slug/task-lists/:listId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: UpdateTaskListDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.update(projectId, listId, dto);
  }

  @Post('projects/:slug/task-lists/:listId/archive')
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.archive(projectId, listId);
  }

  @Post('projects/:slug/task-lists/:listId/unarchive')
  async unarchive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.unarchive(projectId, listId);
  }

  @Delete('projects/:slug/task-lists/:listId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.softDelete(projectId, listId);
  }

  @Patch('projects/:slug/task-lists/reorder')
  async reorderLists(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: ReorderTaskListsDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.reorderLists(projectId, dto);
  }

  @Patch('projects/:slug/task-lists/:listId/tabs/reorder')
  async reorderTabs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: ReorderTabsDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.reorderTabs(projectId, listId, dto);
  }

  @Post('projects/:slug/task-lists/:listId/tabs')
  async createEmbedTab(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: CreateEmbedTabDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.createEmbedTab(projectId, listId, dto);
  }

  @Delete('projects/:slug/task-lists/:listId/tabs/:tabId')
  async deleteTab(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.deleteTab(projectId, listId, tabId);
  }

  @Patch('projects/:slug/task-lists/:listId/statuses')
  async updateStatuses(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: BulkUpdateStatusesDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.lists.updateStatuses(projectId, listId, dto);
  }
}
