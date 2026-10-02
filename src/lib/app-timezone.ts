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
