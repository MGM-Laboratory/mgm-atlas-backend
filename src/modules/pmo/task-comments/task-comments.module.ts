import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { TaskCommentsController } from './task-comments.controller';
import { TaskCommentsService } from './task-comments.service';

@Module({
  imports: [ProjectsModule, NotificationsModule, TasksModule],
  controllers: [TaskCommentsController],
  providers: [TaskCommentsService],
  exports: [TaskCommentsService],
})
export class TaskCommentsModule {}
