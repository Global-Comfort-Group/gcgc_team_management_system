-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "reviewerId" TEXT;

-- CreateTable
CREATE TABLE "board_reviewers" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_reviewers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_reviewers_boardId_idx" ON "board_reviewers"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "board_reviewers_boardId_userId_key" ON "board_reviewers"("boardId", "userId");

-- AddForeignKey
ALTER TABLE "board_reviewers" ADD CONSTRAINT "board_reviewers_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_reviewers" ADD CONSTRAINT "board_reviewers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

