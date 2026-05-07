import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { S3Service } from './s3.service';

@Module({
  imports: [ProjectsModule],
  controllers: [MediaController],
  providers: [S3Service, MediaService],
  exports: [S3Service, MediaService],
})
export class MediaModule {}
