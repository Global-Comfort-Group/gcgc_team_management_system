-- Snapshot of a task's state at the moment it is archived to the Backlog, so
-- restoring returns it to where it was instead of resetting every task to
-- To Do at 0%. Nullable: tasks archived before this migration have no snapshot
-- and keep the old restore-to-TODO behaviour.
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "backlogPriorCustomStatusId" TEXT,
ADD COLUMN     "backlogPriorProgress" INTEGER,
ADD COLUMN     "backlogPriorStatus" "TaskStatus";
