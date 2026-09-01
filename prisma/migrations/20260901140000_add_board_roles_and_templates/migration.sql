-- Custom per-board roles with permissions, role-addressed tasks, and
-- per-board task templates.
--
-- Purely additive: every column is nullable or defaulted and no existing
-- row is touched. A board with no roles behaves exactly as it did before,
-- which is the property that makes shipping an access-control layer to a
-- live system safe.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assignedRoleId" TEXT;

-- CreateTable
CREATE TABLE "board_roles" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "canCreateTask" BOOLEAN NOT NULL DEFAULT false,
    "canEditAnyTask" BOOLEAN NOT NULL DEFAULT false,
    "canDeleteTask" BOOLEAN NOT NULL DEFAULT false,
    "canChangeStatus" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "canManageBoard" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_role_assignments" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_task_templates" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "titlePrefix" TEXT,
    "description" TEXT,
    "priority" "Priority",
    "taskWeight" INTEGER,
    "slaHours" INTEGER,
    "defaultRoleId" TEXT,
    "checklist" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_roles_boardId_idx" ON "board_roles"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "board_roles_boardId_name_key" ON "board_roles"("boardId", "name");

-- CreateIndex
CREATE INDEX "board_role_assignments_userId_idx" ON "board_role_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "board_role_assignments_roleId_userId_key" ON "board_role_assignments"("roleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "board_task_templates_boardId_key" ON "board_task_templates"("boardId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedRoleId_fkey" FOREIGN KEY ("assignedRoleId") REFERENCES "board_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_roles" ADD CONSTRAINT "board_roles_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_role_assignments" ADD CONSTRAINT "board_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "board_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_role_assignments" ADD CONSTRAINT "board_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_task_templates" ADD CONSTRAINT "board_task_templates_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

