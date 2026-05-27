import { Module } from '@nestjs/common';
import { PmoFeatureFlagGuard } from './guards/pmo-feature-flag.guard';
import { TaskListsModule } from './task-lists/task-lists.module';

/**
 * Root PMO module. Submodules are added one per phase as features ship.
 * The feature-flag guard is exported so each submodule's controllers
 * can apply it; whenever PMO_ENABLED is false every PMO route 404s.
 */
@Module({
  imports: [TaskListsModule],
  providers: [PmoFeatureFlagGuard],
  exports: [PmoFeatureFlagGuard],
})
export class PmoModule {}
