/**
 * The company's timezone. The server runs in UTC, but dates people see and
 * type (a due date of "2026-10-10") are Philippine dates. Override with
 * APP_TIMEZONE if the deployment ever serves another region.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Manila'

/** A Date as "YYYY-MM-DD" in the app timezone (en-CA formats as ISO). */
export function ymdInAppTz(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Minutes the app timezone is ahead of UTC at the given instant (+480 for Manila). */
function offsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIMEZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - at.getTime()) / 60000)
}

/**
 * "YYYY-MM-DD" → the instant that date starts in the app timezone, as ISO —
 * what the date picker saves for a Philippine user, whatever timezone the
 * importing browser happens to be in.
 */
export function appTzMidnightIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d))
  return new Date(guess.getTime() - offsetMinutes(guess) * 60000).toISOString()
}
