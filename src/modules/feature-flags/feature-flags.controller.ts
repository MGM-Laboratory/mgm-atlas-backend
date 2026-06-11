import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { FeatureFlagsService } from './feature-flags.service';

@ApiTags('feature-flags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /**
   * Public evaluated flag map for the frontend. Cheap (30s cache), no auth —
   * the values are not secret and the UI needs them on every load.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Evaluated feature flags ({ key: enabled })' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: { type: 'boolean' } } })
  getFlags(): Promise<Record<string, boolean>> {
    return this.flags.evaluateAll();
  }
}
