import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '../projects/project-access.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { TeamService } from './team.service';

@ApiBearerAuth()
@ApiTags('team')
@Controller()
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('projects/:projectId/invites')
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: InviteUserDto,
  ) {
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertManager(access);
    return this.team.invite(user, projectId, dto);
  }

  @Delete('projects/:projectId/invites/:inviteId')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertManager(access);
    return this.team.revokeInvite(projectId, inviteId);
  }

  @Post('invites/:id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.acceptInvite(user, id);
  }

  @Post('invites/:id/decline')
  decline(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.declineInvite(user, id);
  }

  @Patch('projects/:projectId/members/:memberId')
  async updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertManager(access);
    return this.team.updateMember(projectId, memberId, dto);
  }

  @Delete('projects/:projectId/members/:memberId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertManager(access);
    return this.team.removeMember(user, projectId, memberId);
  }
}
