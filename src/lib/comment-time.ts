import { format, formatDistance } from 'date-fns'

/**
 * A comment's timestamp: relative while it's fresh ("5 minutes ago"), the date
 * and time once it's older than a day ("Sep 17, 2:05 PM") — "19 days ago"
 * said nothing useful. The year is added only when it isn't this year.
 */
export function commentTimeLabel(createdAt: string | Date, now: Date = new Date()): string {
  const d = new Date(createdAt)
  if (isNaN(d.getTime())) return ''
  const ageMs = now.getTime() - d.getTime()
  if (ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000) return formatDistance(d, now, { addSuffix: true })
  return format(d, d.getFullYear() === now.getFullYear() ? 'MMM d, h:mm a' : 'MMM d, yyyy, h:mm a')
}

/** The full timestamp, for the hover tooltip. */
export function commentTimeFull(createdAt: string | Date): string {
  const d = new Date(createdAt)
  return isNaN(d.getTime()) ? '' : format(d, 'EEEE, MMM d, yyyy, h:mm a')
}
