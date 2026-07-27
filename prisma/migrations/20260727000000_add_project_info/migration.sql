-- AlterTable
ALTER TABLE "kanban_boards" ADD COLUMN     "manualActualPercent" INTEGER;

-- CreateTable
CREATE TABLE "board_measurements" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_quarter_targets" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "targetPercent" INTEGER NOT NULL DEFAULT 0,
    "actualPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_quarter_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_measurements_boardId_idx" ON "board_measurements"("boardId");

-- CreateIndex
CREATE INDEX "board_quarter_targets_boardId_idx" ON "board_quarter_targets"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "board_quarter_targets_boardId_year_quarter_key" ON "board_quarter_targets"("boardId", "year", "quarter");

-- AddForeignKey
ALTER TABLE "board_measurements" ADD CONSTRAINT "board_measurements_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_quarter_targets" ADD CONSTRAINT "board_quarter_targets_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

