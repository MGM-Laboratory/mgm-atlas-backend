import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { TaskListsModule } from '../task-lists/task-lists.module';
import { UndoModule } from '../undo/undo.module';
import { TaskActivityService } from './task-activity.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [ProjectsModule, TaskListsModule, NotificationsModule, forwardRef(() => UndoModule)],
  controllers: [TasksController],
  providers: [TasksService, TaskActivityService],
  exports: [TasksService, TaskActivityService],
})
export class TasksModule {}
