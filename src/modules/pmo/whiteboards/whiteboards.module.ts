import { Module } from '@nestjs/common';
import { MediaModule } from '@/modules/media/media.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { YjsModule } from '../yjs/yjs.module';
import { WhiteboardsController } from './whiteboards.controller';
import { WhiteboardsService } from './whiteboards.service';

@Module({
  imports: [ProjectsModule, MediaModule, YjsModule],
  controllers: [WhiteboardsController],
  providers: [WhiteboardsService],
  exports: [WhiteboardsService],
})
export class WhiteboardsModule {}
