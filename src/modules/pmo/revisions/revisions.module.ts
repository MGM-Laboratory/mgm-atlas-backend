import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { RevisionsPrunerService } from './revisions-pruner.service';

/**
 * The hourly pruner for NoteRevision / WhiteboardRevision /
 * YDocSnapshotRevision. List + restore endpoints live on the
 * existing notes / whiteboards controllers — this module exists
 * solely to register the pruner singleton on module init.
 */
@Module({
  imports: [PrismaModule],
  providers: [RevisionsPrunerService],
})
export class RevisionsModule {}
