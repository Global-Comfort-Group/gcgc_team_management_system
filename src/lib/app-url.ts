/**
 * The address people use to open the app — what links in emails and API
 * responses point at (field reports 2026-10: email links went to
 * http://10.100.100.86:3000 instead of https://tms.hotelsogo.com).
 *
 * Deliberately NOT NEXTAUTH_URL: that one also drives sign-in callbacks, the
 * Google OAuth redirect and secure-cookie naming, so changing it moves login.
 * Links only need the public name. Override with APP_URL.
 */
export const DEFAULT_APP_URL = 'https://tms.hotelsogo.com'

export function appUrl(): string {
  return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '')
}

/** A link into the app: appLink('/user/teams'). */
export function appLink(path: string): string {
  return `${appUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
