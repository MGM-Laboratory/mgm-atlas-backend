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
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { NotesService } from './notes.service';

@ApiBearerAuth()
@ApiTags('pmo:notes')
@UseGuards(PmoFeatureFlagGuard)
@Controller('projects/:slug/notes')
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly access: ProjectAccessService,
    private readonly yjsTokens: YjsTokenService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.notes.list(projectId);
  }

  @Get(':noteId')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.notes.get(projectId, noteId);
  }

  @Get(':noteId/yjs-token')
  async yjsToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    const note = await this.notes.get(projectId, noteId);

    const authHeader = req.header('authorization') ?? '';
    const sessionId = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    return {
      token: this.yjsTokens.mint(sessionId),
      docKey: note.yDocKey,
      wsUrl: this.config.get<string>('yjs.publicWsUrl') ?? '',
    };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateNoteDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.notes.create(user.id, projectId, dto);
  }

  @Patch(':noteId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateNoteDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.notes.update(projectId, noteId, dto);
  }

  @Delete(':noteId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.notes.remove(projectId, noteId);
  }
}
