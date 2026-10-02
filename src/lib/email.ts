import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM || 'gcgc-tms@hotelsogo-ai.com'

// Notification title/message derive from user content (task titles, comment text),
// so they must be HTML-escaped before interpolating into the email body.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderNotificationEmail(n: { title: string; message: string; url?: string }): { subject: string; html: string } {
  const button = n.url
    ? `<p style="margin:20px 0"><a href="${encodeURI(n.url)}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open in GCGC TMS</a></p>`
    : ''
  const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
    <h2 style="font-size:16px;margin:0 0 8px">${escapeHtml(n.title)}</h2>
    <p style="font-size:14px;color:#334155;margin:0">${escapeHtml(n.message)}</p>
    ${button}
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">You're receiving this from GCGC TMS. Manage notifications in your profile settings.</p>
  </div>`
  return { subject: `GCGC TMS · ${n.title}`, html }
}

export class EmailNotConfiguredError extends Error {
  constructor() { super('Email is not set up on this server (RESEND_API_KEY is missing).') }
}

/**
 * Send one notification email. Throws on failure.
 *
 * Resend reports a rejected send (unverified sender domain, bad key, rate
 * limit) in the RESOLVED result as `{ error }` — it does not throw. This used
 * to ignore that result, so every failed email vanished without a log line
 * (field reports 2026-10: "users don't get notification emails").
 */
export async function sendNotificationEmail(to: string, n: { title: string; message: string; url?: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new EmailNotConfiguredError()
  const { subject, html } = renderNotificationEmail(n)
  const resend = new Resend(key)
  const result = await resend.emails.send({ from: FROM, to, subject, html })
  if (result?.error) {
    throw new Error(`Resend rejected the email from ${FROM}: ${result.error.message || result.error.name || 'unknown error'}`)
  }
}
