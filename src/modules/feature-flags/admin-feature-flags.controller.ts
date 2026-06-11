import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AdminGuard } from '../auth/guards/admin.guard';
import { FeatureFlagsService } from './feature-flags.service';
import { UpsertFeatureFlagDto } from './dto/upsert-feature-flag.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/feature-flags')
@UseGuards(AdminGuard)
export class AdminFeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all feature flags (admin)' })
  list() {
    return this.flags.list();
  }

  @Put(':key')
  @ApiOperation({ summary: 'Create or update a feature flag (admin)' })
  upsert(
    @Param('key') key: string,
    @Body() dto: UpsertFeatureFlagDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Path key is authoritative; body.key (if sent) must match but the path wins.
    return this.flags.upsert(key, dto.enabled, dto.description, user.email);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete a feature flag (admin)' })
  remove(@Param('key') key: string) {
    return this.flags.remove(key);
  }
}
