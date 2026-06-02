import { Module } from '@nestjs/common';
import { FilesModule } from './files/files.module';
import { PmoFeatureFlagGuard } from './guards/pmo-feature-flag.guard';
import { MentionsModule } from './mentions/mentions.module';
import { NotesModule } from './notes/notes.module';
import { RevisionsModule } from './revisions/revisions.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { TaskCommentsModule } from './task-comments/task-comments.module';
import { TaskListsModule } from './task-lists/task-lists.module';
import { TasksModule } from './tasks/tasks.module';
import { TeamModule } from './team/team.module';
import { UndoModule } from './undo/undo.module';
import { WhiteboardsModule } from './whiteboards/whiteboards.module';
import { YjsModule } from './yjs/yjs.module';

/**
 * Root PMO module. Submodules are added one per phase as features ship.
 * The feature-flag guard is exported so each submodule's controllers
 * can apply it; whenever PMO_ENABLED is false every PMO route 404s.
 */
@Module({
  imports: [
    TaskListsModule,
    TasksModule,
    TaskCommentsModule,
    MentionsModule,
    TeamModule,
    FilesModule,
    NotesModule,
    WhiteboardsModule,
    YjsModule,
    RevisionsModule,
    UndoModule,
    SchedulingModule,
  ],
  providers: [PmoFeatureFlagGuard],
  exports: [PmoFeatureFlagGuard],
})
export class PmoModule {}
