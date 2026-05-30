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
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { CreateFolderDto } from './dto/create-folder.dto';
import { DeleteFileQueryDto } from './dto/delete-file.dto';
import { ListFilesQueryDto } from './dto/list-files.dto';
import { PresignFileDto } from './dto/presign-file.dto';
import { RegisterFileDto } from './dto/register-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { FilesService } from './files.service';

@ApiBearerAuth()
@ApiTags('pmo:files')
@UseGuards(PmoFeatureFlagGuard)
@Controller('projects/:slug/files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: ListFilesQueryDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.files.list(projectId, query.folderId);
  }

  @Post('presign')
  async presign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: PresignFileDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.files.presign(projectId, dto);
  }

  @Post('folder')
  async createFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateFolderDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.files.createFolder(user.id, projectId, dto);
  }

  @Post()
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: RegisterFileDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.files.register(user.id, projectId, dto);
  }

  @Patch(':fileId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: UpdateFileDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.files.update(projectId, fileId, dto);
  }

  @Delete(':fileId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query() query: DeleteFileQueryDto,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.files.remove(projectId, fileId, query.force ?? false);
  }
}
