import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';

/**
 * Read the package version once at module load. process.cwd() is /app in
 * the container (package.json is copied there); falls back gracefully in dev.
 */
function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const VERSION_INFO = {
  // Baked at image build time via Docker build-args (see Dockerfile + CI).
  // Empty in local dev so the endpoint still works without a build.
  sha: process.env.GIT_SHA ?? 'dev',
  version: readPackageVersion(),
  builtAt: process.env.BUILD_TIME ?? '',
};

@ApiTags('version')
@Controller('version')
export class VersionController {
  /**
   * Public build-identity endpoint. Used by the deploy pipeline to detect
   * when a new image has converged on a host (poll until `sha` matches the
   * released commit) and for operational/debugging visibility. Cheap, no DB.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Build identity (commit SHA, version, build time)' })
  @ApiOkResponse({
    schema: {
      properties: {
        sha: { type: 'string' },
        version: { type: 'string' },
        builtAt: { type: 'string' },
      },
    },
  })
  getVersion(): { sha: string; version: string; builtAt: string } {
    return VERSION_INFO;
  }
}
