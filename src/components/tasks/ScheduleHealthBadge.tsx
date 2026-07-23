import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  getScheduleHealth,
  type ScheduleCheckable,
  type ScheduleHealth,
} from '@/lib/schedule-health'

// Presentation for each schedule-health state. Delayed reuses the destructive
// token (same red as the old "Overdue" badge it replaces); On Track / Ahead use
// explicit tints since the base Badge has no blue/green variant.
const PRESENTATION: Record<
  ScheduleHealth,
  { full: string; compact: string; className: string }
> = {
  DELAYED: {
    full: 'Delayed',
    compact: 'Delayed',
    className:
      'border-transparent bg-destructive text-destructive-foreground',
  },
  ON_TRACK: {
    full: 'On Track',
    compact: 'On Track',
    className:
      'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  AHEAD: {
    full: 'Ahead of Schedule',
    compact: 'Ahead',
    className:
      'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
}

interface ScheduleHealthBadgeProps {
  task: ScheduleCheckable
  // Shorter labels for dense surfaces (cards, list rows). Default full labels.
  compact?: boolean
  // Optional override for "now" (mainly for tests / fixed-clock rendering).
  now?: Date
  className?: string
}

// Renders the task's schedule-health tag, or nothing when the task carries no
// tag (no due date, or CANCELLED / BACKLOG / legacy done with no timestamps).
// Every surface uses this one component so logic and appearance stay consistent.
export function ScheduleHealthBadge({
  task,
  compact = false,
  now,
  className,
}: ScheduleHealthBadgeProps) {
  const health = getScheduleHealth(task, now)
  if (!health) return null
  const p = PRESENTATION[health]
  return (
    <Badge
      size="sm"
      className={cn(p.className, className)}
      title={p.full}
    >
      {compact ? p.compact : p.full}
    </Badge>
  )
}

export default ScheduleHealthBadge
