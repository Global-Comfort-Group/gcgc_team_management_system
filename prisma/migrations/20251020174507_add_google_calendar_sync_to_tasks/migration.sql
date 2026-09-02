-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleCalendarEventId" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

