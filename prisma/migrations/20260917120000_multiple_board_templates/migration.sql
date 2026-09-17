-- A board may now hold several named task templates (field report 2026-09).
-- Existing single templates keep working: they become "Default".

-- DropIndex
DROP INDEX "board_task_templates_boardId_key";

-- AlterTable
ALTER TABLE "board_task_templates"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Default',
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "board_task_templates_boardId_idx" ON "board_task_templates"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "board_task_templates_boardId_name_key" ON "board_task_templates"("boardId", "name");
