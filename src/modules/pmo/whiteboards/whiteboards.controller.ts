import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { YjsTokenService } from '../yjs/yjs-token.service';
import { CreateWhiteboardDto } from './dto/create-whiteboard.dto';
import { PresignThumbnailDto } from './dto/presign-thumbnail.dto';
import { UpdateWhiteboardDto } from './dto/update-whiteboard.dto';
import { WhiteboardsService } from './whiteboards.service';

@ApiBearerAuth()
@ApiTags('pmo:whiteboards')
@UseGuards(PmoFeatureFlagGuard)
@Controller('projects/:slug/whiteboards')
export class WhiteboardsController {
  constructor(
    private readonly whiteboards: WhiteboardsService,
    private readonly access: ProjectAccessService,
    private readonly yjsTokens: YjsTokenService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.list(projectId);
  }

  @Get(':wbId')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('wbId', ParseUUIDPipe) wbId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.get(projectId, wbId);
  }

  @Get(':wbId/export')
  async exportMgm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('wbId', ParseUUIDPipe) wbId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.export(projectId, wbId);
  }

  @Get(':wbId/yjs-token')
  async yjsToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('wbId', ParseUUIDPipe) wbId: string,
    @Req() req: Request,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    const wb = await this.whiteboards.get(projectId, wbId);
    const authHeader = req.header('authorization') ?? '';
    const sessionId = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    return {
      token: this.yjsTokens.mint(sessionId),
      docKey: wb.yDocKey,
      wsUrl: this.config.get<string>('yjs.publicWsUrl') ?? '',
    };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateWhiteboardDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.create(user.id, projectId, dto);
  }

  @Post(':wbId/thumbnail/presign')
  async presignThumbnail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('wbId', ParseUUIDPipe) wbId: string,
    @Body() dto: PresignThumbnailDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.presignThumbnail(projectId, wbId, dto);
  }

  @Patch(':wbId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('wbId', ParseUUIDPipe) wbId: string,
    @Body() dto: UpdateWhiteboardDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.update(projectId, wbId, dto);
  }

  @Delete(':wbId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('wbId', ParseUUIDPipe) wbId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.whiteboards.remove(projectId, wbId);
  }
}
