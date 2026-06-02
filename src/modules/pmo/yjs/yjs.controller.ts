import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { YjsAuthorizeDto } from './dto/authorize.dto';
import { YjsSnapshotDto } from './dto/snapshot.dto';
import { InternalYjsGuard } from './guards/internal-yjs.guard';
import { YjsService } from './yjs.service';

/**
 * Internal callbacks for the y-websocket sidecar. Not user-facing:
 * `@Public()` bypasses the session guard; `InternalYjsGuard` authenticates
 * the sidecar via the HMAC headers instead.
 */
@ApiExcludeController()
@Public()
@UseGuards(PmoFeatureFlagGuard, InternalYjsGuard)
@Controller('internal/yjs')
export class YjsController {
  constructor(private readonly yjs: YjsService) {}

  @Post('authorize')
  authorize(@Body() dto: YjsAuthorizeDto) {
    return this.yjs.authorize(dto.docKey, dto.token);
  }

  @Get('snapshot')
  load(@Query('docKey') docKey: string) {
    return this.yjs.loadSnapshot(docKey);
  }

  @Post('snapshot')
  save(@Body() dto: YjsSnapshotDto) {
    return this.yjs.saveSnapshot(dto.docKey, dto.state, dto.size, dto.authorId ?? null);
  }
}
