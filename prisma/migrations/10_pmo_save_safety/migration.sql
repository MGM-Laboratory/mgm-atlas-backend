-- PMO save-safety PR1 — additive only.
--
-- Adds the MOVED variant to the TaskActivityKind enum so that
-- kanban position-only moves (within the same column) and full
-- moves across columns can both be recorded in the audit trail.
-- Previously only STATUS_CHANGED was recorded, and only when the
-- column changed; pure reorders left no breadcrumb.
--
-- Rollback path: the previous backend image never sets MOVED, so the
-- new value is dead but harmless. Existing rows are untouched.

ALTER TYPE "TaskActivityKind" ADD VALUE 'MOVED';
