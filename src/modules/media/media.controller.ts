import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProjectRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import {
  ProjectRoleGuard,
  RequireProjectRole,
} from '../auth/guards/project-role.guard';
import { ProjectAccessService } from '../projects/project-access.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { RegisterMediaDto } from './dto/register-media.dto';
import { ReorderMediaDto } from './dto/reorder-media.dto';
import { MediaService } from './media.service';

@ApiBearerAuth()
@ApiTags('media')
@UseGuards(ProjectRoleGuard)
@RequireProjectRole(ProjectRole.PROJECT_MANAGER)
@Controller('projects/:projectId/media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('presign')
  presign(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: PresignUploadDto,
  ) {
    return this.media.presignUpload(projectId, dto);
  }

  @Post()
  register(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RegisterMediaDto,
  ) {
    return this.media.registerMedia(projectId, dto);
  }

  @Patch('reorder')
  reorder(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ReorderMediaDto,
  ) {
    return this.media.reorder(projectId, dto.orderedIds);
  }

  @Delete(':mediaId')
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.media.remove(projectId, mediaId);
  }
}
