import { Module } from '@nestjs/common';
import { MediaModule } from '@/modules/media/media.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [ProjectsModule, MediaModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
