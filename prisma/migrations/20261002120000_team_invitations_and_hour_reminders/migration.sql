-- Field reports 2026-10: team invitations (accept/decline before joining) and
-- task reminders measured in hours instead of whole days.

-- New notification type for invitations. ADD VALUE can't be undone and is a
-- no-op if it already exists.
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'TEAM_INVITATION';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_invitations_teamId_userId_key" ON "team_invitations"("teamId", "userId");
CREATE INDEX "team_invitations_userId_status_idx" ON "team_invitations"("userId", "status");

ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reminders in hours. Existing day-based reminders carry over (days * 24).
-- reminderDays stays so the previous release still reads valid data.
ALTER TABLE "tasks" ADD COLUMN "reminderHours" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "tasks" ADD COLUMN "remindersSentHours" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
UPDATE "tasks"
SET "reminderHours" = ARRAY(SELECT d * 24 FROM unnest("reminderDays") AS d ORDER BY d)
WHERE cardinality("reminderDays") > 0;
