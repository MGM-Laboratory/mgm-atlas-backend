import { Module } from '@nestjs/common';
import { PmoFeatureFlagGuard } from './guards/pmo-feature-flag.guard';

/**
 * Root PMO module. Submodules (task-lists, tasks, task-comments,
 * task-attachments, files, notes, whiteboards, yjs) are added one per
 * phase starting at Phase 1. The feature-flag guard is exported so each
 * future submodule can pull it into its controllers.
 */
@Module({
  providers: [PmoFeatureFlagGuard],
  exports: [PmoFeatureFlagGuard],
})
export class PmoModule {}
