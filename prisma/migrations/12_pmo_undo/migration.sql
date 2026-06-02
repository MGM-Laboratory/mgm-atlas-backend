-- PMO durable undo (PR3) — additive only.
--
-- One row per reversible PMO mutation. Read by POST /pmo/undo and
-- POST /pmo/redo, written by tasks.service mutations inside their
-- existing Prisma transaction so the audit + reversal entry are atomic
-- with the state change.
--
-- Rollback path: the previous backend image never writes rows here;
-- the table sits empty until traffic hits the new code.

-- CreateTable
CREATE TABLE "UndoEntry" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taskId" TEXT,
    "forwardOp" JSONB NOT NULL,
    "inverseOp" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "redoneAt" TIMESTAMP(3),

    CONSTRAINT "UndoEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UndoEntry_actorId_appliedAt_idx" ON "UndoEntry"("actorId", "appliedAt");

-- CreateIndex
CREATE INDEX "UndoEntry_actorId_undoneAt_idx" ON "UndoEntry"("actorId", "undoneAt");

-- CreateIndex
CREATE INDEX "UndoEntry_taskId_idx" ON "UndoEntry"("taskId");

-- AddForeignKey
ALTER TABLE "UndoEntry" ADD CONSTRAINT "UndoEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

