-- Task ticket numbers: a human-quotable id per task ("OPS-14").
--
-- ticketPrefix is UNIQUE so exactly one board owns a prefix; without that, two
-- boards would independently allocate OPS-5 and the second task creation would
-- violate tasks.ticketNumber_key.
--
-- ticket_sequence is a single row holding the counter for board-less tasks.
-- 58% of production tasks have no board, so a per-board scheme alone would
-- leave the majority of work unnumbered.
--
-- All columns are nullable / defaulted: existing rows are untouched and keep
-- working with no ticket number until the backfill script is run.

-- AlterTable
ALTER TABLE "kanban_boards" ADD COLUMN     "ticketCounter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ticketPrefix" VARCHAR(10);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "ticketNumber" TEXT;

-- CreateTable
CREATE TABLE "ticket_sequence" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "prefix" VARCHAR(10) NOT NULL DEFAULT 'TMS',
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kanban_boards_ticketPrefix_key" ON "kanban_boards"("ticketPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_ticketNumber_key" ON "tasks"("ticketNumber");

-- Seed the single global counter row so allocation never has to create it.
INSERT INTO "ticket_sequence" ("id", "prefix", "counter") VALUES ('global', 'TMS', 0)
ON CONFLICT ("id") DO NOTHING;
