'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, LayoutGrid, Loader2, Pencil, Trash2, Users, UserPlus, Crown, X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import type { Team, SelectableUser } from '@/types/team'

type PendingInvite = { id: string; userId: string; role: 'LEADER' | 'MEMBER'; createdAt: string; user: { id: string; name?: string | null; email: string; image?: string | null } }

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const { toast } = useToast()
  const router = useRouter()

  const [team, setTeam] = useState<Team | null>(null)
  const [pending, setPending] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [showRename, setShowRename] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [prefixValue, setPrefixValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [allUsers, setAllUsers] = useState<SelectableUser[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  const [showLeave, setShowLeave] = useState(false)

  const fetchTeam = useCallback(async () => {
    try {
      const res = await fetch(`/api/user/teams/${id}`)
      if (res.status === 404) { setNotFound(true); return }
      if (res.ok) {
        const data = await res.json()
        setTeam(data.team)
        setPending(data.pendingInvitations || [])
      }
    } catch (e) {
      console.error('Error fetching team:', e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (session?.user) fetchTeam()
  }, [session?.user, fetchTeam])

  const canManage =
    !!team &&
    (session?.user?.role === 'ADMIN' ||
      team.members.some(m => m.userId === session?.user?.id && m.role === 'LEADER'))

  const saveRename = async () => {
    if (!team || !renameValue.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/user/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim(), ticketPrefix: prefixValue.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setTeam(data.team)
        setShowRename(false)
        toast({ title: 'Team updated' })
      } else {
        const err = await res.json().catch(() => ({}))
        // A prefix clash comes back 409 with the owning board named.
        toast({ title: 'Could not save', description: err.error, variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const deleteTeam = async () => {
    if (!team) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/user/teams/${team.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Team deleted' })
        router.push('/user/teams')
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not delete', description: err.error, variant: 'destructive' })
        setDeleting(false)
      }
    } catch {
      setDeleting(false)
    }
  }

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        const data = await res.json()
        setAllUsers(data.users || [])
      }
    } catch (e) {
      console.error('Error loading users:', e)
    }
  }

  // Reload every time, not just once: the cached list meant a user added to
  // the system after the dialog's first open stayed invisible until a full
  // page reload.
  const openAddDialog = () => { setUserQuery(''); setShowAdd(true); loadUsers() }

  const addMember = async (userId: string) => {
    if (!team) return
    setBusyUserId(userId)
    try {
      const res = await fetch(`/api/user/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: 'MEMBER' }),
      })
      if (res.ok) {
        await fetchTeam()
        toast({ title: 'Invitation sent', description: 'They join the team once they accept.' })
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not send the invitation', description: err.error, variant: 'destructive' })
      }
    } finally {
      setBusyUserId(null)
    }
  }

  const cancelInvite = async (inv: PendingInvite) => {
    if (!team) return
    setBusyUserId(inv.userId)
    try {
      const res = await fetch(`/api/user/teams/${team.id}/invitations/${inv.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not cancel the invitation', description: err.error, variant: 'destructive' })
      }
      await fetchTeam()
    } finally {
      setBusyUserId(null)
    }
  }

  const setRole = async (userId: string, role: 'LEADER' | 'MEMBER') => {
    if (!team) return
    setBusyUserId(userId)
    try {
      const res = await fetch(`/api/user/teams/${team.id}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (res.ok) {
        await fetchTeam()
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not change role', description: err.error, variant: 'destructive' })
      }
    } finally {
      setBusyUserId(null)
    }
  }

  const removeMember = async (userId: string) => {
    if (!team) return
    setBusyUserId(userId)
    try {
      const res = await fetch(`/api/user/teams/${team.id}/members/${userId}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchTeam()
        toast({ title: 'Member removed' })
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not remove member', description: err.error, variant: 'destructive' })
      }
    } finally {
      setBusyUserId(null)
    }
  }

  const leaveTeam = async () => {
    if (!team || !session?.user?.id) return
    try {
      const res = await fetch(`/api/user/teams/${team.id}/members/${session.user.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'You left the team' })
        router.push('/user/teams')
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not leave team', description: err.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Could not leave team', variant: 'destructive' })
    }
  }

  const myMembership = team ? team.members.find(m => m.userId === session?.user?.id) : undefined
  const canLeave = !!myMembership && !canManage

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
  }
  if (notFound || !team) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center">
        <p className="text-muted-foreground">Team not found, or you&apos;re not a member.</p>
        <Link href="/user/teams"><Button variant="outline" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Teams</Button></Link>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Link href="/user/teams" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Teams
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: team.board?.color || '#3B82F6' }} />
          <h1 className="text-2xl font-bold truncate">{team.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {team.board && (
            <Link href={`/user/tasks?board=${team.board.id}`}>
              <Button variant="outline" size="sm"><LayoutGrid className="h-4 w-4 mr-2" /> Open board</Button>
            </Link>
          )}
          {canLeave && (
            <Button variant="outline" size="sm" onClick={() => setShowLeave(true)}>Leave team</Button>
          )}
          {canManage && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setRenameValue(team.name); setPrefixValue((team as any).board?.ticketPrefix ?? ''); setShowRename(true) }}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setShowDelete(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <section id="team-members" className="border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Members ({team.members.length})</h2>
          {canManage && (
            <Button size="sm" variant="outline" onClick={openAddDialog}><UserPlus className="h-4 w-4 mr-2" /> Invite member</Button>
          )}
        </div>
        <ul className="divide-y">
          {team.members.map(m => {
            const isSelf = m.userId === session?.user?.id
            const leaderCount = team.members.filter(x => x.role === 'LEADER').length
            const isLastLeader = m.role === 'LEADER' && leaderCount === 1
            return (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={m.user.image || undefined} />
                  <AvatarFallback>{(m.user.name || m.user.email)[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.user.name || m.user.email}{isSelf && <span className="text-muted-foreground"> (you)</span>}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.user.email}</p>
                </div>
                <Badge variant={m.role === 'LEADER' ? 'default' : 'secondary'} className="text-[10px] flex items-center gap-1">
                  {m.role === 'LEADER' && <Crown className="h-3 w-3" />}{m.role === 'LEADER' ? 'Leader' : 'Member'}
                </Badge>
                {canManage && (
                  <div className="flex items-center gap-1">
                    {m.role === 'MEMBER' ? (
                      <Button size="sm" variant="ghost" disabled={busyUserId === m.userId} onClick={() => setRole(m.userId, 'LEADER')} title="Make leader">
                        {busyUserId === m.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busyUserId === m.userId || isLastLeader} onClick={() => setRole(m.userId, 'MEMBER')} title={isLastLeader ? 'A team needs at least one leader' : 'Demote to member'}>
                        {busyUserId === m.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4 opacity-40" />}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busyUserId === m.userId || isLastLeader} onClick={() => removeMember(m.userId)} title={isLastLeader ? 'A team needs at least one leader' : 'Remove from team'}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {pending.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Invited — waiting for an answer ({pending.length})</h3>
            <ul className="divide-y">
              {pending.map(inv => (
                <li key={inv.id} className="flex items-center gap-3 py-2.5">
                  <Avatar className="h-8 w-8 opacity-70">
                    <AvatarImage src={inv.user.image || undefined} />
                    <AvatarFallback>{(inv.user.name || inv.user.email)[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate text-slate-600">{inv.user.name || inv.user.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{inv.user.email}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">Pending</Badge>
                  {canManage && (
                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busyUserId === inv.userId} onClick={() => cancelInvite(inv)} title="Cancel invitation">
                      {busyUserId === inv.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Team settings</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rename">Team name</Label>
              <Input id="rename" value={renameValue} maxLength={100} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename() }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prefix">Ticket prefix</Label>
              <Input
                id="prefix"
                value={prefixValue}
                maxLength={10}
                placeholder="e.g. OPS"
                className="font-mono uppercase"
                onChange={e => setPrefixValue(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') saveRename() }}
              />
              <p className="text-xs text-muted-foreground">
                {prefixValue.trim()
                  ? <>New tasks on this board will be numbered <span className="font-mono font-medium text-foreground">{prefixValue.trim().toUpperCase()}-1</span>, {prefixValue.trim().toUpperCase()}-2, and so on.</>
                  : <>Leave blank to use the shared numbering (<span className="font-mono">TMS-1</span>, <span className="font-mono">TMS-2</span>…). Existing ticket numbers never change.</>}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRename(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveRename} disabled={saving || !renameValue.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Delete this team?"
        description="This permanently deletes the team, its board, and all tasks on that board. This cannot be undone."
        confirmationText={team.name}
        confirmLabel="Delete team"
        loading={deleting}
        onConfirm={deleteTeam}
      />

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
            <DialogDescription>Invite an existing user to this team. They get a notification and an email, and join only once they accept.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="relative mb-3">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by name or email…" value={userQuery} onChange={e => setUserQuery(e.target.value)} />
            </div>
            {(() => {
              const available = allUsers.filter(u => !team.members.some(m => m.userId === u.id) && !pending.some(p => p.userId === u.id))
              const q = userQuery.trim().toLowerCase()
              const matches = available.filter(u =>
                !q || (u.name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
              )
              // The list is capped for rendering cost, but a silent cap on an
              // alphabetical roster is why "some members never appear": past
              // the 50th name they were simply gone with nothing on screen to
              // say so. Render the cap, and tell the user to search.
              const VISIBLE_LIMIT = 50
              const hiddenCount = Math.max(0, matches.length - VISIBLE_LIMIT)
              return (
                <ul className="max-h-72 overflow-y-auto divide-y">
                  {matches.slice(0, VISIBLE_LIMIT).map(u => (
                    <li key={u.id} className="flex items-center gap-3 py-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={u.image || undefined} />
                        <AvatarFallback>{(u.name || u.email)[0]?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{u.name || u.email}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={busyUserId === u.id} onClick={() => addMember(u.id)}>
                        {busyUserId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      </Button>
                    </li>
                  ))}
                  {available.length === 0 && (
                    <li className="py-6 text-center text-sm text-muted-foreground">No users available to invite.</li>
                  )}
                  {available.length > 0 && matches.length === 0 && (
                    <li className="py-6 text-center text-sm text-muted-foreground">No users match &quot;{userQuery}&quot;.</li>
                  )}
                  {hiddenCount > 0 && (
                    <li className="py-3 text-center text-xs text-amber-600">
                      +{hiddenCount} more not shown — type a name or email to find them.
                    </li>
                  )}
                </ul>
              )
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showLeave} onOpenChange={setShowLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this team?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll lose access to its board. You can be re-added by a team leader later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); leaveTeam() }}>
              Leave team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
