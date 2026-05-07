import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
