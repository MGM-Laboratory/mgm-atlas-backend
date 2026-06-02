import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { UndoController } from './undo.controller';
import { UndoService } from './undo.service';

@Module({
  imports: [PrismaModule, ProjectsModule, forwardRef(() => TasksModule)],
  controllers: [UndoController],
  providers: [UndoService],
  exports: [UndoService],
})
export class UndoModule {}
