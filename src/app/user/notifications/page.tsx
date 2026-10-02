'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { UserAvatar } from '@/components/shared/UserAvatar'
import { PendingInvitations } from '@/components/teams/PendingInvitations'

type Notif = { id: string; title: string; message: string; isRead: boolean; entityType?: string | null; entityId?: string | null; createdAt: string }
type Act = { id: string; description: string; createdAt: string; entityType?: string | null; entityId?: string | null; user: { id: string; name: string; email: string; image?: string } }

export default function NotificationsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'inbox' | 'activity'>('inbox')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [acts, setActs] = useState<Act[]>([])
  const [loading, setLoading] = useState(true)

  const loadInbox = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/notifications?limit=50${unreadOnly ? '&unreadOnly=true' : ''}`)
    const json = await res.json().catch(() => ({ notifications: [] }))
    setNotifs(json.notifications ?? [])
    setLoading(false)
  }, [unreadOnly])

  const loadActivity = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/activities?limit=50')
    const json = await res.json().catch(() => ({ activities: [] }))
    setActs(json.activities ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { tab === 'inbox' ? loadInbox() : loadActivity() }, [tab, loadInbox, loadActivity])

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markAllRead: true }) })
    loadInbox()
  }

  function openNotif(n: Notif) {
    if (n.entityType === 'task' && n.entityId) router.push(`/user/tasks?taskId=${n.entityId}`)
    else if (n.entityType === 'team_invitation') router.push('/user/teams')
    else if (n.entityType === 'team' && n.entityId) router.push(`/user/teams/${n.entityId}`)
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
        {tab === 'inbox' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setUnreadOnly(v => !v)} className="px-2.5 h-8 rounded-md text-xs font-semibold border border-slate-200 hover:border-blue-300">
              {unreadOnly ? 'Show all' : 'Unread only'}
            </button>
            <button onClick={markAllRead} className="px-2.5 h-8 rounded-md text-xs font-semibold bg-blue-600 text-white">Mark all read</button>
          </div>
        )}
      </div>

      <PendingInvitations />

      <div className="flex gap-1 border-b mb-3">
        {(['inbox', 'activity'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 h-9 text-sm font-semibold capitalize border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t === 'inbox' ? 'Inbox' : 'Activity'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
      ) : tab === 'inbox' ? (
        notifs.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">No notifications.</div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {notifs.map(n => (
              <li key={n.id}>
                <button onClick={() => openNotif(n)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${!n.isRead ? 'bg-blue-50/40' : ''}`}>
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-600 shrink-0" />}
                    <div className="min-w-0">
                      <p className={`text-sm ${!n.isRead ? 'font-semibold' : 'text-slate-700'}`}>{n.title}</p>
                      <p className="text-xs text-slate-500">{n.message}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : acts.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">No recent activity.</div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {acts.map(a => (
            <li key={a.id} className="px-4 py-3 flex items-start gap-2.5">
              <UserAvatar userId={a.user.id} image={a.user.image} name={a.user.name} email={a.user.email} className="h-6 w-6" fallbackClassName="text-[10px]" />
              <div className="min-w-0">
                <p className="text-sm text-slate-700"><span className="font-semibold">{a.user.name || a.user.email}</span> {a.description}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
