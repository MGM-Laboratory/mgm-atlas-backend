import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { TeamService } from './team.service';

@ApiBearerAuth()
@ApiTags('pmo:team')
@UseGuards(PmoFeatureFlagGuard)
@Controller()
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:slug/pmo/team')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertInsider(access);
    return this.team.get(projectId);
  }
}
