import { Module } from '@nestjs/common';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { MentionsController } from './mentions.controller';
import { MentionsService } from './mentions.service';

@Module({
  imports: [ProjectsModule],
  controllers: [MentionsController],
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
