import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ContributionRequestStatus } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '../projects/project-access.service';
import { ContributionsService } from './contributions.service';
import { ResolveRequestDto } from './dto/resolve-request.dto';
import { SubmitRequestDto } from './dto/submit-request.dto';

@ApiBearerAuth()
@ApiTags('contributions')
@Controller()
export class ContributionsController {
  constructor(
    private readonly contributions: ContributionsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('projects/:slug/contribute')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: SubmitRequestDto,
  ) {
    return this.contributions.submit(user, slug, dto);
  }

  @Get('projects/:slug/contributions')
  async listForProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query('status') status?: ContributionRequestStatus,
  ) {
    const { projectId, access } = await this.access.resolve(slug, user);
    this.access.assertManager(access);
    return this.contributions.listForProject(projectId, status);
  }

  @Get('contributions/mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.contributions.listMine(user.id);
  }

  @Post('contributions/:id/withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contributions.withdraw(user, id);
  }

  @Post('contributions/:id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveRequestDto,
  ) {
    return this.contributions.approve(user, id, dto);
  }

  @Post('contributions/:id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveRequestDto,
  ) {
    return this.contributions.reject(user, id, dto);
  }
}
