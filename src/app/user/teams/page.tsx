'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Users, Plus, Loader2, CheckSquare, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import type { Team } from '@/types/team'

const COLOR_CHOICES = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1']

export default function TeamsPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_CHOICES[0])
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/user/teams')
      if (res.ok) {
        const data = await res.json()
        setTeams(data.teams || [])
      }
    } catch (e) {
      console.error('Error fetching teams:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session?.user) fetchTeams()
  }, [session?.user, fetchTeams])

  const createTeam = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/user/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color, category: category.trim() || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        setTeams(prev => [data.team, ...prev])
        setShowCreate(false)
        setName('')
        setColor(COLOR_CHOICES[0])
        setCategory('')
        toast({ title: `Team "${data.team.name}" created` })
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Could not create team', description: err.error || 'Please try again', variant: 'destructive' })
      }
    } catch (e) {
      console.error('Error creating team:', e)
      toast({ title: 'Could not create team', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const myRole = (team: Team): string | null =>
    team.members.find(m => m.userId === session?.user?.id)?.role ?? null

  // Filter team/board cards by team name or board name (case-insensitive).
  const trimmedQuery = query.trim().toLowerCase()
  const filteredTeams = trimmedQuery
    ? teams.filter(
        t =>
          t.name.toLowerCase().includes(trimmedQuery) ||
          (t.board?.name?.toLowerCase().includes(trimmedQuery) ?? false)
      )
    : teams

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header — refined hero (matches dashboard) */}
      <div
        className="relative overflow-hidden rounded-2xl border border-slate-200/70 shadow-sm mb-6 motion-safe:animate-slide-up"
        style={{ animationFillMode: 'backwards' }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-slate-50" />
        <div className="pointer-events-none absolute -top-24 -right-12 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-indigo-200/20 blur-3xl" />
        <div className="relative backdrop-blur-[2px] p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-blue-600 text-white shadow-sm">
                  <Users className="h-5 w-5" />
                </span>
                <h1 className="text-[1.75rem] font-bold text-slate-900 tracking-tight leading-none">My Teams</h1>
              </div>
              <p className="text-sm text-slate-600 max-w-xl">
                Spin up a team for a project, add members, and give each its own task board.
              </p>
              {teams.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-slate-400" />
                    <span className="font-medium tabular-nums">{teams.length}</span> {teams.length === 1 ? 'team' : 'teams'}
                  </span>
                  {teams.filter(t => myRole(t) === 'LEADER').length > 0 && (
                    <>
                      <span className="h-4 w-px bg-slate-300/70 hidden sm:block" />
                      <span className="inline-flex items-center gap-1.5">
                        <CheckSquare className="h-4 w-4 text-slate-400" />
                        <span className="font-medium tabular-nums">{teams.filter(t => myRole(t) === 'LEADER').length}</span> leading
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <Button onClick={() => setShowCreate(true)} className="shrink-0 self-start sm:self-auto shadow-sm">
              <Plus className="h-4 w-4 mr-2" /> New Team
            </Button>
          </div>
        </div>
      </div>

      {!loading && teams.length > 0 && (
        <div className="relative mb-4 sm:max-w-xs">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search teams or boards…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading teams…
        </div>
      ) : teams.length === 0 ? (
        <div className="relative overflow-hidden text-center py-20 border border-dashed border-slate-300 rounded-2xl bg-gradient-to-br from-slate-50 to-white">
          <div className="grid place-items-center w-14 h-14 mx-auto rounded-2xl bg-blue-50 text-blue-500">
            <Users className="h-7 w-7" />
          </div>
          <p className="mt-4 font-semibold text-slate-700">You&apos;re not in any team yet</p>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">Create a team to give your project its own members and task board.</p>
          <Button className="mt-5 shadow-sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" /> Create your first team
          </Button>
        </div>
      ) : filteredTeams.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-300 rounded-2xl bg-slate-50/50">
          <p className="text-sm text-slate-500">No teams match “{query}”.</p>
          <button
            onClick={() => setQuery('')}
            className="mt-2 text-sm font-medium text-blue-600 hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTeams.map((team, i) => {
            const role = myRole(team)
            const memberCount = team._count?.members ?? team.members.length
            const taskCount = team._count?.tasks ?? 0
            const dotColor = team.board?.color || '#3B82F6'
            return (
              <Card
                key={team.id}
                className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg hover:-translate-y-1 transition-all duration-300 rounded-xl motion-safe:animate-slide-up"
                style={{ animationDelay: `${Math.min(i, 8) * 55}ms`, animationFillMode: 'backwards' }}
              >
                {/* board-color top accent */}
                <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: dotColor }} />
                <CardContent className="p-4 pt-5 space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="shrink-0 grid place-items-center w-9 h-9 rounded-lg text-white font-bold text-sm shadow-sm"
                        style={{ backgroundColor: dotColor }}
                      >
                        {team.name?.[0]?.toUpperCase() || 'T'}
                      </span>
                      <span className="font-semibold text-slate-900 truncate text-sm">{team.name}</span>
                    </div>
                    {role && (
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] rounded-md ${
                          role === 'LEADER'
                            ? 'border-blue-300 text-blue-700 bg-blue-50'
                            : 'border-slate-300 text-slate-600 bg-slate-50'
                        }`}
                      >
                        {role === 'LEADER' ? 'Leader' : 'Member'}
                      </Badge>
                    )}
                  </div>

                  {/* member avatar stack + task count */}
                  <div className="flex items-center justify-between">
                    {memberCount > 0 ? (
                      <div className="flex -space-x-2">
                        {team.members.slice(0, 4).map(m => (
                          <Avatar key={m.userId} className="h-7 w-7 ring-2 ring-white">
                            <AvatarImage src={m.user.image || undefined} className="object-cover" />
                            <AvatarFallback className="text-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                              {(m.user.name || m.user.email)?.[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {memberCount > 4 && (
                          <span className="grid place-items-center h-7 w-7 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium ring-2 ring-white">
                            +{memberCount - 4}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">No members</span>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                      <CheckSquare className="h-3.5 w-3.5 text-slate-400" />
                      <span>{taskCount} {taskCount === 1 ? 'task' : 'tasks'}</span>
                    </div>
                  </div>

                  {/* Actions: "Open board" is the primary CTA (consistent blue —
                      readable contrast, unlike a per-team colored fill); team color
                      stays as the accent bar + tile. "Manage" is the quieter secondary. */}
                  <div className="flex items-center gap-2 pt-2.5 border-t border-slate-100">
                    {team.board && (
                      <Link href={`/user/tasks?board=${team.board.id}`} className="flex-1">
                        <Button size="sm" className="h-7 text-xs w-full bg-blue-600 hover:bg-blue-700 text-white">
                          Open board
                        </Button>
                      </Link>
                    )}
                    <Link href={`/user/teams/${team.id}`} className={team.board ? 'shrink-0' : 'flex-1'}>
                      <Button variant="outline" size="sm" className="h-7 text-xs w-full">
                        Manage
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create a team</DialogTitle>
            <DialogDescription>A team gets its own task board automatically. You become its first leader.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Q3 Website Revamp"
                maxLength={100}
                onKeyDown={e => { if (e.key === 'Enter') createTeam() }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-category">Category <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="team-category"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="e.g. Finance, Marketing — leave blank for none"
                maxLength={60}
                onKeyDown={e => { if (e.key === 'Enter') createTeam() }}
              />
              <p className="text-xs text-muted-foreground">Groups this board under a label in your board switcher. Only you see it.</p>
            </div>
            <div className="space-y-2">
              <Label>Board color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_CHOICES.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Choose color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createTeam} disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
