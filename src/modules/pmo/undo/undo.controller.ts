import {
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PmoFeatureFlagGuard } from '../guards/pmo-feature-flag.guard';
import { UpdateTaskDto } from '../tasks/dto/update-task.dto';
import { TasksService } from '../tasks/tasks.service';
import { UndoService } from './undo.service';

/**
 * Server-backed Cmd+Z. POST /pmo/undo applies the inverse of the
 * actor's most recent undoable mutation; POST /pmo/redo re-applies
 * the forward. Both routes are scoped to the calling user — Megumi
 * can't undo Lab MGM's drag.
 *
 * Dispatch goes back through the regular service methods so the
 * normal access checks + activity log still apply. State divergence
 * (target deleted, status removed, etc.) surfaces as a 409 so the FE
 * can show a meaningful toast instead of a silent failure.
 */
@ApiBearerAuth()
@ApiTags('pmo:undo')
@UseGuards(PmoFeatureFlagGuard)
@Controller('pmo')
export class UndoController {
  private readonly logger = new Logger(UndoController.name);

  constructor(
    private readonly undo: UndoService,
    private readonly tasks: TasksService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('undo')
  @HttpCode(200)
  async undoLast(@CurrentUser() user: AuthenticatedUser) {
    const entry = await this.undo.popUndo(user);
    try {
      const applied = await this.applyOp(user, entry.kind, entry.inverseOp);
      return {
        kind: entry.kind,
        scope: entry.scope,
        taskId: entry.taskId,
        applied,
      };
    } catch (err) {
      // Roll back the undoneAt stamp so the user can try again or pick a
      // different entry — leaving it stamped would silently drop a row.
      await this.undo.revertUndo(entry);
      throw err;
    }
  }

  @Post('redo')
  @HttpCode(200)
  async redoLast(@CurrentUser() user: AuthenticatedUser) {
    const entry = await this.undo.popRedo(user);
    try {
      const applied = await this.applyOp(user, entry.kind, entry.forwardOp);
      return {
        kind: entry.kind,
        scope: entry.scope,
        taskId: entry.taskId,
        applied,
      };
    } catch (err) {
      await this.undo.revertUndo(entry);
      throw err;
    }
  }

  private async applyOp(
    user: AuthenticatedUser,
    kind: string,
    op: unknown,
  ): Promise<unknown> {
    if (kind === 'TASK_MOVED') {
      const m = UndoService.asTaskMoved(op as never);
      const task = await this.tasks.findById(m.taskId);
      if (!task) throw new NotFoundException('Task no longer exists.');
      const { projectId, access } = await this.access.resolve(task.projectId, user);
      this.access.assertInsider(access);
      return this.tasks.move(user, this.access.asInsiderKind(access), projectId, m.taskId, {
        statusId: m.statusId,
        positionInStatus: Number(m.positionInStatus),
      });
    }
    if (kind === 'TASK_UPDATED') {
      const u = UndoService.asTaskUpdated(op as never);
      const task = await this.tasks.findById(u.taskId);
      if (!task) throw new NotFoundException('Task no longer exists.');
      const { projectId, access } = await this.access.resolve(task.projectId, user);
      this.access.assertInsider(access);
      // The undo entry's `fields` payload was generated from the same
      // shape UpdateTaskDto expects (mirrored by TaskUpdatedOp.fields).
      // The cast is unavoidable because JSON loses enum/Date typing.
      return this.tasks.update(
        user,
        this.access.asInsiderKind(access),
        projectId,
        u.taskId,
        u.fields as unknown as UpdateTaskDto,
      );
    }
    throw new NotFoundException(`Unknown undo kind: ${kind}`);
  }
}
