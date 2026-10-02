/**
 * Task reminders are stored as "hours before the due date" (reminderHours).
 * Older clients and the public API send whole days (reminderDays); this turns
 * either into the stored form. reminderHours wins when both are sent.
 */
export const MAX_REMINDER_HOURS = 24 * 365
export const MAX_REMINDERS = 10

export function resolveReminderHours(input: {
  reminderHours?: number[] | null
  reminderDays?: number[] | null
}): number[] | undefined {
  const source = input.reminderHours ?? (input.reminderDays ? input.reminderDays.map((d) => d * 24) : undefined)
  if (source === undefined) return undefined
  return Array.from(new Set(source.filter((h) => Number.isInteger(h) && h > 0 && h <= MAX_REMINDER_HOURS)))
    .sort((a, b) => b - a)
    .slice(0, MAX_REMINDERS)
}

export type LeadUnit = 'hours' | 'days'

/** Hours → the friendliest {amount, unit}: whole days when it divides evenly. */
export function splitHours(hours: number): { amount: number; unit: LeadUnit } {
  return hours % 24 === 0 ? { amount: hours / 24, unit: 'days' } : { amount: hours, unit: 'hours' }
}

/** A typed amount + unit → whole hours, or null when it isn't a positive whole amount. */
export function toHours(amount: string | number, unit: LeadUnit): number | null {
  const n = typeof amount === 'number' ? amount : Number(String(amount).trim())
  if (!Number.isInteger(n) || n <= 0) return null
  const h = unit === 'days' ? n * 24 : n
  return h <= MAX_REMINDER_HOURS ? h : null
}

export function describeHours(hours: number): string {
  const { amount, unit } = splitHours(hours)
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`
}
