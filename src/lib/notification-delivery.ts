import { prisma } from '@/lib/prisma'
import { sendNotificationEmail, EmailNotConfiguredError } from '@/lib/email'
import { sendWebPush } from '@/lib/web-push'
import { appUrl } from '@/lib/app-url'

export function plannedDeliveries(prefs: { emailNotifications: boolean; pushNotifications: boolean }): ('email' | 'push')[] {
  const out: ('email' | 'push')[] = []
  if (prefs.emailNotifications) out.push('email')
  if (prefs.pushNotifications) out.push('push')
  return out
}

export function entityUrl(n: { entityType?: string | null; entityId?: string | null }): string | undefined {
  const base = appUrl()
  // The Tasks page opens a task from ?taskId= (it was ?task=, which opened nothing).
  if (n.entityType === 'task' && n.entityId) return `${base}/user/tasks?taskId=${n.entityId}`
  if (n.entityType === 'board' && n.entityId) return `${base}/user/tasks?board=${n.entityId}`
  if (n.entityType === 'team_invitation') return `${base}/user/teams`
  if (n.entityType === 'team' && n.entityId) return `${base}/user/teams/${n.entityId}`
  return `${base}/user/dashboard`
}

export async function deliverNotification(
  userId: string,
  n: { title: string; message: string; entityType?: string | null; entityId?: string | null }
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailNotifications: true, pushNotifications: true, pushSubscriptions: true },
    })
    if (!user) return
    const channels = plannedDeliveries(user)
    const url = entityUrl(n)
    if (channels.includes('email') && user.email) {
      await sendNotificationEmail(user.email, { title: n.title, message: n.message, url }).catch(e => {
        if (e instanceof EmailNotConfiguredError) console.info('[deliver] email skipped:', e.message)
        else console.error('[deliver] email to', user.email, 'failed:', e?.message || e)
      })
    }
    if (channels.includes('push')) {
      await Promise.all(user.pushSubscriptions.map(s =>
        sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: n.title, body: n.message, url })
          .catch(e => console.error('[deliver] push', e))
      ))
    }
  } catch (e) {
    console.error('[deliver] failed for', userId, e)
  }
}
