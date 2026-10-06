import { formatDistance } from 'date-fns'

/**
 * Comment timestamps (field reports 2026-10, reported twice).
 *
 * Shown in Philippine time whatever the viewer's computer is set to: date-fns
 * `format` uses the browser's timezone, so a PC left on UTC showed every
 * comment 8 hours early. And a computer clock that runs slow made a brand-new
 * comment read "in 2 minutes", so anything in the future reads "just now".
 */
export const COMMENT_TIMEZONE = 'Asia/Manila'

const DAY = 24 * 60 * 60 * 1000

function inManila(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: COMMENT_TIMEZONE, ...opts }).format(d)
}

/**
 * Relative while it's fresh ("5 minutes ago"), the date and time once it's
 * older than a day ("Sep 17, 3:28 PM"); the year only when it isn't this year.
 */
export function commentTimeLabel(createdAt: string | Date, now: Date = new Date()): string {
  const d = new Date(createdAt)
  if (isNaN(d.getTime())) return ''
  const ageMs = now.getTime() - d.getTime()
  if (ageMs < 60 * 1000) return 'just now' // includes a viewer clock that runs behind
  if (ageMs < DAY) return formatDistance(d, now, { addSuffix: true })
  const sameYear = inManila(d, { year: 'numeric' }) === inManila(now, { year: 'numeric' })
  return inManila(d, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** The full timestamp, for the hover tooltip. */
export function commentTimeFull(createdAt: string | Date): string {
  const d = new Date(createdAt)
  if (isNaN(d.getTime())) return ''
  return `${inManila(d, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} (PH time)`
}
