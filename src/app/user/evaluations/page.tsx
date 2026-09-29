'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from 'date-fns'
import {
  Star, Plus, X, BarChart3, Users, Award, TrendingUp, Calendar, Filter,
  ArrowRight, MessageSquare, Search, Eye, ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { UserAvatar } from '@/components/shared/UserAvatar'
import { cn } from '@/lib/utils'
import { formatRating } from '@/lib/evaluation-score'

type Period = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
type GradientScore = 0 | 25 | 50 | 75 | 100

interface User {
  id: string
  name: string
  email: string
  image?: string
  role: string
}

interface Evaluation {
  id: string
  period: Period
  gradientScore: number
  comments?: string
  evaluatedAt: string
  periodStartDate: string
  periodEndDate: string
  evaluator: User
  evaluatee: User
  task?: { id: string; title: string }
}

const GRADIENT_OPTIONS: {
  score: GradientScore
  label: string
  sublabel: string
  dot: string
  badge: string
  accent: string
}[] = [
  { score: 0,   label: '1', sublabel: 'None',      dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-700 border-slate-300',      accent: 'border-l-slate-400'   },
  { score: 25,  label: '2', sublabel: 'Poor',      dot: 'bg-red-400',     badge: 'bg-red-100 text-red-700 border-red-300',            accent: 'border-l-red-400'     },
  { score: 50,  label: '3', sublabel: 'Fair',      dot: 'bg-amber-400',   badge: 'bg-amber-100 text-amber-700 border-amber-300',      accent: 'border-l-amber-400'   },
  { score: 75,  label: '4', sublabel: 'Good',      dot: 'bg-blue-400',    badge: 'bg-blue-100 text-blue-700 border-blue-300',         accent: 'border-l-blue-400'    },
  { score: 100, label: '5', sublabel: 'Excellent', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', accent: 'border-l-emerald-500' },
]

function getScoreOption(score: number) {
  return GRADIENT_OPTIONS.find(o => o.score === score) ?? GRADIENT_OPTIONS[0]
}

function getProgressColor(score: number) {
  if (score >= 100) return 'bg-emerald-500'
  if (score >= 75)  return 'bg-blue-500'
  if (score >= 50)  return 'bg-amber-400'
  if (score >= 25)  return 'bg-red-400'
  return 'bg-slate-300'
}

function getPeriodDates(period: Period) {
  const now = new Date()
  switch (period) {
    case 'DAILY':     return { start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') }
    case 'WEEKLY':    return { start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
    case 'MONTHLY':   return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'QUARTERLY': return { start: format(startOfQuarter(now), 'yyyy-MM-dd'), end: format(endOfQuarter(now), 'yyyy-MM-dd') }
  }
}

const PERIOD_LABEL: Record<Period, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly' }
const PERIOD_BADGE: Record<Period, string> = {
  DAILY:     'bg-purple-100 text-purple-700 border-purple-200',
  WEEKLY:    'bg-blue-100 text-blue-700 border-blue-200',
  MONTHLY:   'bg-orange-100 text-orange-700 border-orange-200',
  QUARTERLY: 'bg-teal-100 text-teal-700 border-teal-200',
}

export default function EvaluationsPage() {
  const { data: session } = useSession()
  const { toast } = useToast()

  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [filterPeriod, setFilterPeriod] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 10

  // Member detail modal
  const [viewingMember, setViewingMember] = useState<User | null>(null)
  const [memberEvals, setMemberEvals] = useState<Evaluation[]>([])
  const [loadingMemberEvals, setLoadingMemberEvals] = useState(false)

  // Form state
  const [formEvaluateeId, setFormEvaluateeId] = useState('')
  const [formPeriod, setFormPeriod] = useState<Period>('WEEKLY')
  const [formScore, setFormScore] = useState<GradientScore | null>(null)
  const [formComments, setFormComments] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isLeaderOrAdmin = session?.user?.role === 'LEADER' || session?.user?.role === 'ADMIN'

  useEffect(() => {
    fetchEvaluations()
    if (isLeaderOrAdmin) fetchUsers()
  }, [filterPeriod])

  useEffect(() => { setCurrentPage(1) }, [searchTerm, filterPeriod])

  const fetchEvaluations = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filterPeriod !== 'all') params.set('period', filterPeriod)
      if (!isLeaderOrAdmin) params.set('evaluateeId', session?.user?.id || '')
      const res = await fetch(`/api/evaluations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEvaluations(data.evaluations || [])
      } else {
        toast({ title: 'Failed to load evaluations', description: 'Please try refreshing the page.', variant: 'destructive' })
      }
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to load evaluations', description: 'Check your connection and try again.', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  const fetchUsers = async () => {
    try {
      // A leader evaluates only their own team members (reports-to + teams they
      // lead); an admin can evaluate anyone.
      const isLeader = session?.user?.role === 'LEADER'
      const res = await fetch(isLeader ? '/api/user/team-members' : '/api/users?limit=100&isActive=true')
      if (res.ok) { const d = await res.json(); setUsers((isLeader ? d.members : d.users) || []) }
      else { toast({ title: 'Failed to load team members', variant: 'destructive' }) }
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to load team members', description: 'Check your connection and try again.', variant: 'destructive' })
    }
  }

  const openMemberDetail = async (member: User) => {
    setViewingMember(member)
    setLoadingMemberEvals(true)
    try {
      const params = new URLSearchParams()
      params.set('evaluateeId', member.id)
      const res = await fetch(`/api/evaluations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setMemberEvals(data.evaluations || [])
      } else {
        toast({ title: 'Failed to load member evaluations', variant: 'destructive' })
      }
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to load member evaluations', description: 'Check your connection and try again.', variant: 'destructive' })
    } finally { setLoadingMemberEvals(false) }
  }

  // Team Overview's "Evaluate" links here with ?evaluateeId=… — open that
  // member's history straight away instead of the general list.
  const [deepLinkHandled, setDeepLinkHandled] = useState(false)
  useEffect(() => {
    if (deepLinkHandled || !isLeaderOrAdmin || users.length === 0) return
    const id = new URLSearchParams(window.location.search).get('evaluateeId')
    setDeepLinkHandled(true)
    const member = id ? users.find(u => u.id === id) : undefined
    if (member) openMemberDetail(member)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, isLeaderOrAdmin, deepLinkHandled])

  const closeMemberDetail = () => {
    setViewingMember(null)
    setMemberEvals([])
  }

  const handleSubmit = async () => {
    if (!formEvaluateeId || formScore === null) {
      toast({ title: 'Required fields missing', description: 'Select a member and a score.', variant: 'destructive' })
      return
    }
    try {
      setSubmitting(true)
      const { start, end } = getPeriodDates(formPeriod)
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluateeId: formEvaluateeId,
          period: formPeriod,
          gradientScore: formScore,
          comments: formComments || undefined,
          periodStartDate: start,
          periodEndDate: end,
        })
      })
      if (res.ok) {
        toast({ title: 'Evaluation submitted successfully' })
        setShowForm(false)
        setFormEvaluateeId('')
        setFormScore(null)
        setFormComments('')
        fetchEvaluations()
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error || 'Something went wrong.', variant: 'destructive' })
      }
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to submit evaluation', description: 'Check your connection and try again.', variant: 'destructive' })
    } finally { setSubmitting(false) }
  }

  const closeForm = () => {
    setShowForm(false)
    setFormEvaluateeId('')
    setFormScore(null)
    setFormComments('')
  }

  // Derived stats
  const totalEvals = evaluations.length
  const avgScore = totalEvals > 0
    ? Math.round(evaluations.reduce((s, e) => s + e.gradientScore, 0) / totalEvals)
    : 0
  const excellentCount = evaluations.filter(e => e.gradientScore >= 75).length
  const uniqueMembers = new Set(evaluations.map(e => e.evaluatee.id)).size

  const { start: previewStart, end: previewEnd } = getPeriodDates(formPeriod)

  // Search filter applied client-side
  const filtered = searchTerm.trim()
    ? evaluations.filter(ev => {
        const q = searchTerm.toLowerCase()
        return (
          (ev.evaluatee.name || '').toLowerCase().includes(q) ||
          (ev.evaluatee.email || '').toLowerCase().includes(q) ||
          (ev.evaluator.name || '').toLowerCase().includes(q)
        )
      })
    : evaluations

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const paginated = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // Member detail modal stats
  const memberAvgScore = memberEvals.length > 0
    ? Math.round(memberEvals.reduce((s, e) => s + e.gradientScore, 0) / memberEvals.length)
    : 0
  const memberHighCount = memberEvals.filter(e => e.gradientScore >= 75).length
  const memberEvaluatorCount = new Set(memberEvals.map(e => e.evaluator.id)).size

  return (
    <div className="space-y-8">

      {/* ── Gradient Hero Header ── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-slate-50 to-purple-50 opacity-60" />
        <div className="relative backdrop-blur-sm bg-white/40 border border-slate-200/60 rounded-xl shadow-sm p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                {isLeaderOrAdmin ? 'HR Evaluations' : 'My Evaluations'}
              </h1>
              <p className="text-slate-600 text-base font-medium">
                {isLeaderOrAdmin
                  ? 'Track and record performance evaluations across your team by period.'
                  : 'Every performance evaluation your leaders have recorded for you, by period.'}
              </p>
            </div>
            {isLeaderOrAdmin && (
              <Button className="shadow-sm shrink-0" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Evaluation
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-6", isLeaderOrAdmin ? "lg:grid-cols-4" : "lg:grid-cols-3")}>

        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-blue-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Total</CardTitle>
            <div className="p-2.5 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <BarChart3 className="h-5 w-5 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{totalEvals}</div>
              <span className="text-sm text-slate-500 font-medium">evaluations</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">All time</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-purple-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Avg Score</CardTitle>
            <div className="p-2.5 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
              <TrendingUp className="h-5 w-5 text-purple-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{formatRating(avgScore, 1)}</div>
              <span className="text-sm text-slate-500 font-medium">/ 5</span>
            </div>
            <div className="space-y-1.5">
              <Progress value={avgScore} className="h-1.5 bg-slate-100" />
              <p className="text-xs text-slate-500">{getScoreOption(avgScore < 25 ? 0 : avgScore < 50 ? 25 : avgScore < 75 ? 50 : avgScore < 100 ? 75 : 100).sublabel} overall</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">High Scores</CardTitle>
            <div className="p-2.5 bg-emerald-50 rounded-lg group-hover:bg-emerald-100 transition-colors">
              <Award className="h-5 w-5 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{excellentCount}</div>
              <span className="text-sm text-slate-500 font-medium">Good+</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">Rated 4 or above</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>

        {isLeaderOrAdmin && (
        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-amber-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Members</CardTitle>
            <div className="p-2.5 bg-amber-50 rounded-lg group-hover:bg-amber-100 transition-colors">
              <Users className="h-5 w-5 text-amber-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{uniqueMembers}</div>
              <span className="text-sm text-slate-500 font-medium">evaluated</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">Unique members</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-amber-600 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>
        )}

      </div>

      {/* ── Filter Bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-500 shrink-0">
          <Filter className="h-4 w-4" />
          <span className="font-medium">Filter by:</span>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder={isLeaderOrAdmin ? 'Search by member or evaluator name...' : 'Search by evaluator name...'}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 h-9 border-slate-200 bg-slate-50 text-sm rounded-lg"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={filterPeriod} onValueChange={setFilterPeriod}>
          <SelectTrigger className="w-44 border-slate-200 bg-slate-50 rounded-lg h-9 text-sm">
            <SelectValue placeholder="All periods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Periods</SelectItem>
            <SelectItem value="DAILY">Daily</SelectItem>
            <SelectItem value="WEEKLY">Weekly</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
            <SelectItem value="QUARTERLY">Quarterly</SelectItem>
          </SelectContent>
        </Select>

        {(filterPeriod !== 'all' || searchTerm) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-500 hover:text-slate-700 h-9"
            onClick={() => { setFilterPeriod('all'); setSearchTerm('') }}
          >
            <X className="h-3.5 w-3.5 mr-1.5" /> Clear filters
          </Button>
        )}

        <div className="ml-auto text-sm text-slate-500 shrink-0">
          <span className="font-semibold text-slate-900">{filtered.length}</span>
          {filtered.length !== evaluations.length && (
            <span className="text-slate-400"> of {evaluations.length}</span>
          )}
          <span> evaluation{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* ── Evaluations List ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            <p className="text-sm text-slate-500">Loading evaluations...</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="p-4 bg-slate-100 rounded-full mb-4">
            <Star className="h-10 w-10 text-slate-300" />
          </div>
          <h3 className="text-base font-semibold text-slate-600 mb-1">No evaluations found</h3>
          <p className="text-sm text-slate-400 max-w-xs">
            {filterPeriod !== 'all' || searchTerm
              ? 'Try adjusting your filters to see more results.'
              : isLeaderOrAdmin
              ? 'Get started by creating the first evaluation for your team.'
              : 'No evaluations have been submitted for your account yet.'}
          </p>
          {isLeaderOrAdmin && filterPeriod === 'all' && !searchTerm && (
            <Button className="mt-6" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" /> New Evaluation
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {paginated.map(ev => {
            const opt = getScoreOption(ev.gradientScore)
            return (
              <div
                key={ev.id}
                onClick={() => openMemberDetail(ev.evaluatee)}
                className={cn(
                  "group bg-white rounded-xl border border-slate-200 border-l-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer",
                  opt.accent
                )}
              >
                <div className="p-5">
                  {/* Row 1 — Avatar + name + meta + score badge */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        userId={ev.evaluatee.id}
                        image={ev.evaluatee.image}
                        name={ev.evaluatee.name}
                        email={ev.evaluatee.email}
                        className="h-10 w-10 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{ev.evaluatee.name || ev.evaluatee.email}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Evaluated by <span className="font-medium text-slate-700">{ev.evaluator.name || ev.evaluator.email}</span>
                          {' · '}
                          {format(new Date(ev.evaluatedAt), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={cn("text-xs border font-medium px-2 py-0.5", PERIOD_BADGE[ev.period])}>
                        {PERIOD_LABEL[ev.period]}
                      </Badge>
                      <Badge className={cn("text-sm border font-bold px-3 py-1", opt.badge)}>
                        <span className={cn("w-2 h-2 rounded-full mr-1.5 inline-block", opt.dot)} />
                        {formatRating(ev.gradientScore)}/5 · {opt.sublabel}
                      </Badge>
                      <div className="flex items-center gap-1 text-xs text-slate-400 group-hover:text-blue-600 transition-colors ml-1">
                        <Eye className="h-3.5 w-3.5" />
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* Row 2 — Score bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(ev.periodStartDate), 'MMM d')} – {format(new Date(ev.periodEndDate), 'MMM d, yyyy')}
                        {ev.task && (
                          <span className="ml-2 text-slate-500">· Task: <span className="font-medium text-slate-700">{ev.task.title}</span></span>
                        )}
                      </span>
                      <span className="font-semibold text-slate-600">{formatRating(ev.gradientScore)}/5</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={cn("h-2 rounded-full transition-all", getProgressColor(ev.gradientScore))}
                        style={{ width: `${ev.gradientScore}%` }}
                      />
                    </div>
                  </div>

                  {/* Row 3 — Comments */}
                  {ev.comments && (
                    <div className="flex items-start gap-2 bg-slate-50 rounded-lg px-4 py-3 mt-2">
                      <MessageSquare className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-slate-600 italic leading-relaxed">"{ev.comments}"</p>
                    </div>
                  )}

                  {/* View hint */}
                  <p className="text-xs text-slate-400 group-hover:text-blue-500 mt-3 text-right transition-colors">
                    {isLeaderOrAdmin ? 'Click to view all evaluations for this member →' : 'Click to view your full evaluation history →'}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {!loading && filtered.length > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-4">
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{(safePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safePage * ITEMS_PER_PAGE, filtered.length)}</span> of <span className="font-semibold text-slate-900">{filtered.length}</span> evaluations
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="border-slate-200 h-8 px-3 text-sm"
            >
              Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, idx) =>
                p === '...'
                  ? <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 text-sm">…</span>
                  : <button
                      key={p}
                      onClick={() => setCurrentPage(p as number)}
                      className={cn(
                        "h-8 w-8 rounded-lg text-sm font-medium transition-all",
                        safePage === p
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 border border-slate-200"
                      )}
                    >
                      {p}
                    </button>
              )}
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(p => p + 1)}
              className="border-slate-200 h-8 px-3 text-sm"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Member Detail Modal ── */}
      <Dialog open={!!viewingMember} onOpenChange={(open) => { if (!open) closeMemberDetail() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            {viewingMember && (
              <div className="flex items-center gap-4 pb-2">
                <UserAvatar
                  userId={viewingMember.id}
                  image={viewingMember.image}
                  name={viewingMember.name}
                  email={viewingMember.email}
                  className="h-14 w-14 shrink-0"
                />
                <div className="min-w-0">
                  <DialogTitle className="text-xl font-bold text-slate-900">
                    {viewingMember.name || viewingMember.email}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-slate-500 mt-0.5">
                    {viewingMember.email} · <span className="capitalize">{viewingMember.role?.toLowerCase()}</span>
                  </DialogDescription>
                </div>
              </div>
            )}
          </DialogHeader>

          {/* Mini Stats */}
          {!loadingMemberEvals && memberEvals.length > 0 && (
            <div className="grid grid-cols-3 gap-3 shrink-0">
              <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-100">
                <p className="text-2xl font-bold text-blue-700">{memberEvals.length}</p>
                <p className="text-xs text-blue-600 font-medium mt-0.5">Total Evaluations</p>
              </div>
              <div className={cn("rounded-xl p-4 text-center border", memberAvgScore >= 75 ? 'bg-emerald-50 border-emerald-100' : memberAvgScore >= 50 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100')}>
                <p className={cn("text-2xl font-bold", memberAvgScore >= 75 ? 'text-emerald-700' : memberAvgScore >= 50 ? 'text-amber-700' : 'text-red-700')}>{formatRating(memberAvgScore, 1)}/5</p>
                <p className={cn("text-xs font-medium mt-0.5", memberAvgScore >= 75 ? 'text-emerald-600' : memberAvgScore >= 50 ? 'text-amber-600' : 'text-red-600')}>Average Score</p>
              </div>
              <div className="bg-purple-50 rounded-xl p-4 text-center border border-purple-100">
                <p className="text-2xl font-bold text-purple-700">{memberEvaluatorCount}</p>
                <p className="text-xs text-purple-600 font-medium mt-0.5">Evaluator{memberEvaluatorCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}

          {/* Evaluations List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingMemberEvals ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center space-y-3">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600 mx-auto" />
                  <p className="text-sm text-slate-500">Loading evaluations...</p>
                </div>
              </div>
            ) : memberEvals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="p-3 bg-slate-100 rounded-full mb-3">
                  <Star className="h-8 w-8 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-600">No evaluations yet</p>
                <p className="text-xs text-slate-400 mt-1">This member hasn't been evaluated.</p>
              </div>
            ) : (
              <div className="space-y-3 pr-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  All Evaluations Received · {memberEvals.length} record{memberEvals.length !== 1 ? 's' : ''}
                </p>
                {memberEvals.map(ev => {
                  const opt = getScoreOption(ev.gradientScore)
                  return (
                    <div
                      key={ev.id}
                      className={cn(
                        "bg-white rounded-xl border border-slate-200 border-l-4 shadow-sm",
                        opt.accent
                      )}
                    >
                      <div className="p-4">
                        {/* Evaluator row */}
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <UserAvatar
                              userId={ev.evaluator.id}
                              image={ev.evaluator.image}
                              name={ev.evaluator.name}
                              email={ev.evaluator.email}
                              className="h-8 w-8 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{ev.evaluator.name || ev.evaluator.email}</p>
                              <p className="text-xs text-slate-400">{format(new Date(ev.evaluatedAt), 'MMM d, yyyy · h:mm a')}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge className={cn("text-xs border font-medium px-2 py-0.5", PERIOD_BADGE[ev.period])}>
                              {PERIOD_LABEL[ev.period]}
                            </Badge>
                            <Badge className={cn("text-sm border font-bold px-2.5 py-0.5", opt.badge)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full mr-1 inline-block", opt.dot)} />
                              {formatRating(ev.gradientScore)}/5
                            </Badge>
                          </div>
                        </div>

                        {/* Score bar */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(ev.periodStartDate), 'MMM d')} – {format(new Date(ev.periodEndDate), 'MMM d, yyyy')}
                            </span>
                            <span className="font-semibold">{opt.sublabel}</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={cn("h-1.5 rounded-full", getProgressColor(ev.gradientScore))}
                              style={{ width: `${ev.gradientScore}%` }}
                            />
                          </div>
                        </div>

                        {/* Comments */}
                        {ev.comments && (
                          <div className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2 mt-2">
                            <MessageSquare className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                            <p className="text-xs text-slate-600 italic leading-relaxed">"{ev.comments}"</p>
                          </div>
                        )}

                        {ev.task && (
                          <p className="text-xs text-slate-400 mt-2">
                            Task: <span className="font-medium text-slate-600">{ev.task.title}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={closeMemberDetail} className="border-slate-200">
              Close
            </Button>
            {isLeaderOrAdmin && (
              <Button onClick={() => { closeMemberDetail(); setFormEvaluateeId(viewingMember?.id || ''); setShowForm(true) }}>
                <Plus className="h-4 w-4 mr-2" /> Evaluate This Member
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Evaluation Dialog ── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) closeForm() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <div className="p-1.5 bg-blue-50 rounded-lg">
                <Star className="h-4 w-4 text-blue-600" />
              </div>
              New Evaluation
            </DialogTitle>
            <DialogDescription>
              Submit a performance evaluation for a team member.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">

            {/* Member */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">
                Team Member <span className="text-red-500">*</span>
              </Label>
              <Select value={formEvaluateeId} onValueChange={setFormEvaluateeId}>
                <SelectTrigger className="border-slate-200 rounded-lg bg-slate-50">
                  <SelectValue placeholder="Select member to evaluate..." />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter(u => u.id !== session?.user?.id)
                    .map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        <div className="flex items-center gap-2">
                          <span>{u.name || u.email}</span>
                          <span className="text-xs text-slate-400">({u.role})</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Period */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">
                Evaluation Period <span className="text-red-500">*</span>
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'] as Period[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFormPeriod(p)}
                    className={cn(
                      "px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                      formPeriod === p
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "border-slate-200 text-slate-600 bg-slate-50 hover:border-blue-300 hover:bg-blue-50"
                    )}
                  >
                    {PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Period: {format(new Date(previewStart), 'MMM d')} – {format(new Date(previewEnd), 'MMM d, yyyy')}
              </p>
            </div>

            {/* Score */}
            <div className="space-y-2.5">
              <Label className="text-sm font-semibold text-slate-700">
                Performance Score (1–5) <span className="text-red-500">*</span>
              </Label>
              <div className="grid grid-cols-5 gap-2">
                {GRADIENT_OPTIONS.map(opt => (
                  <button
                    key={opt.score}
                    type="button"
                    onClick={() => setFormScore(opt.score)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all",
                      formScore === opt.score
                        ? "border-slate-800 shadow-md scale-105"
                        : "border-transparent hover:border-slate-300 opacity-70 hover:opacity-100"
                    )}
                  >
                    <span className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm", opt.dot)}>
                      {opt.label}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-600">{opt.sublabel}</span>
                  </button>
                ))}
              </div>
              {formScore !== null && (
                <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium", getScoreOption(formScore).badge)}>
                  <span className={cn("w-2 h-2 rounded-full", getScoreOption(formScore).dot)} />
                  {getScoreOption(formScore).sublabel} — {formatRating(formScore)}/5
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">
                Comments <span className="text-slate-400 font-normal text-xs">(optional)</span>
              </Label>
              <Textarea
                placeholder="Add feedback, notes, or observations..."
                value={formComments}
                onChange={e => setFormComments(e.target.value)}
                className="min-h-[80px] resize-none border-slate-200 bg-slate-50 focus:bg-white rounded-lg"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeForm} className="border-slate-200">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !formEvaluateeId || formScore === null}
            >
              {submitting ? 'Submitting...' : 'Submit Evaluation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
