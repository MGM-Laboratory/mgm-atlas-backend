import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { MentionsService, type MentionSuggestionKind } from './mentions.service';

const ALLOWED_KINDS: MentionSuggestionKind[] = ['user', 'task'];

@ApiBearerAuth()
@ApiTags('pmo:mentions')
@UseGuards(PmoFeatureFlagGuard)
@Controller()
export class MentionsController {
  constructor(
    private readonly mentions: MentionsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:slug/pmo/mention-search')
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query('kind') kindRaw?: string,
    @Query('q') q?: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    const kind = (kindRaw ?? 'user') as MentionSuggestionKind;
    if (!ALLOWED_KINDS.includes(kind)) {
      throw new BadRequestException(`Unsupported mention kind: ${kindRaw}`);
    }
    return this.mentions.search(projectId, kind, q ?? '');
  }
}
