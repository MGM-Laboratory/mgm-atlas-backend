-- PMO revisions (PR2) — additive only.
--
-- Three new history tables for the History drawer + future audit needs:
--   • NoteRevision         (JSON projection of a BlockNote doc at save time)
--   • WhiteboardRevision   (JSON projection of an Excalidraw scene at save time)
--   • YDocSnapshotRevision (binary Yjs CRDT state — full-fidelity restore)
--
-- Each ties to its parent via ON DELETE CASCADE (note/whiteboard delete
-- cleans up its history) and to its author via ON DELETE SET NULL (a deleted
-- user keeps their historical revisions, just anonymized). isCheckpoint marks
-- per-hour milestone rows the pruner never deletes.
--
-- Rollback path: previous backend image never writes these tables; they
-- sit empty until traffic hits the new code.

-- CreateTable
CREATE TABLE "NoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "size" INTEGER NOT NULL,
    "authorId" TEXT,
    "isCheckpoint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhiteboardRevision" (
    "id" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "sceneSnapshot" JSONB NOT NULL,
    "size" INTEGER NOT NULL,
    "authorId" TEXT,
    "isCheckpoint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YDocSnapshotRevision" (
    "id" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "authorId" TEXT,
    "isCheckpoint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YDocSnapshotRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteRevision_noteId_createdAt_idx" ON "NoteRevision"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteRevision_noteId_isCheckpoint_idx" ON "NoteRevision"("noteId", "isCheckpoint");

-- CreateIndex
CREATE INDEX "WhiteboardRevision_whiteboardId_createdAt_idx" ON "WhiteboardRevision"("whiteboardId", "createdAt");

-- CreateIndex
CREATE INDEX "WhiteboardRevision_whiteboardId_isCheckpoint_idx" ON "WhiteboardRevision"("whiteboardId", "isCheckpoint");

-- CreateIndex
CREATE INDEX "YDocSnapshotRevision_docKey_createdAt_idx" ON "YDocSnapshotRevision"("docKey", "createdAt");

-- CreateIndex
CREATE INDEX "YDocSnapshotRevision_docKey_isCheckpoint_idx" ON "YDocSnapshotRevision"("docKey", "isCheckpoint");

-- AddForeignKey
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ProjectNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardRevision" ADD CONSTRAINT "WhiteboardRevision_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardRevision" ADD CONSTRAINT "WhiteboardRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YDocSnapshotRevision" ADD CONSTRAINT "YDocSnapshotRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 7.8.0                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
