'use client'
import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Mail, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

type Invitation = {
  id: string
  role: 'LEADER' | 'MEMBER'
  createdAt: string
  team: { id: string; name: string; description?: string | null }
  invitedBy: { name?: string | null; email: string }
}

/**
 * The signed-in user's team invitations, each with Accept / Decline. Renders
 * nothing when there are none, so it can sit at the top of any page.
 * `onAnswered` lets the host page refresh (e.g. the Teams list after accepting).
 */
export function PendingInvitations({ onAnswered }: { onAnswered?: (accepted: boolean) => void }) {
  const { toast } = useToast()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/user/invitations').catch(() => null)
    if (res?.ok) setInvitations((await res.json()).invitations || [])
  }, [])
  useEffect(() => { load() }, [load])

  const answer = async (inv: Invitation, accept: boolean) => {
    setBusy(inv.id)
    try {
      const res = await fetch(`/api/user/invitations/${inv.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: accept ? 'accept' : 'decline' }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Something went wrong')
      toast({ title: accept ? `You joined ${inv.team.name}` : 'Invitation declined' })
      setInvitations((cur) => cur.filter((x) => x.id !== inv.id))
      onAnswered?.(accept)
    } catch (e: any) {
      toast({ title: 'Could not answer the invitation', description: e.message, variant: 'destructive' })
      load()
    } finally {
      setBusy(null)
    }
  }

  if (invitations.length === 0) return null
  return (
    <section aria-label="Team invitations" className="mb-6 space-y-2">
      {invitations.map((inv) => (
        <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <div className="grid place-items-center h-9 w-9 rounded-full bg-blue-100 text-blue-700 shrink-0">
            <Mail className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              {inv.invitedBy.name || inv.invitedBy.email} invited you to join <span className="text-blue-700">{inv.team.name}</span>
            </p>
            <p className="text-xs text-slate-600">
              As a {inv.role === 'LEADER' ? 'leader' : 'member'}. You&apos;ll see the team&apos;s board and tasks once you accept.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" disabled={busy === inv.id} onClick={() => answer(inv, false)}>
              <X className="h-4 w-4 mr-1" /> Decline
            </Button>
            <Button size="sm" disabled={busy === inv.id} onClick={() => answer(inv, true)}>
              {busy === inv.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Accept
            </Button>
          </div>
        </div>
      ))}
    </section>
  )
}
