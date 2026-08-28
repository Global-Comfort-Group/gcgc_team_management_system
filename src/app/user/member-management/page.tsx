'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  Plus,
  Search,
  Filter,
  Clock,
  AlertCircle,
  CheckSquare,
  MoreHorizontal,
  Target,
  Users,
  Trash2,
  Activity,
  Award,
  AlertTriangle,
  BarChart3,
  ListTodo,
  Eye,
  ArrowRight,
  ArrowUpDown,
  Loader2,
  X,
  ChevronsUpDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import TaskForm from '@/components/tasks/TaskForm'
import TaskViewModal from '@/components/tasks/TaskViewModal'
import { useTaskRefresh } from '@/hooks/useTaskRefresh'

interface TeamMember {
  id: string
  name: string
  firstName?: string
  lastName?: string
  email: string
  image?: string
  role: string
  // Where this person came from: the reports-to hierarchy, a team the leader
  // manages, or both. Surfaced as a badge so "why is this person here?" (and
  // "why were they missing?") has a visible answer.
  sources?: ('reports-to' | 'team')[]
  teams?: { id: string; name: string }[]
  _count?: {
    assignedTasks: number
  }
}

interface Task {
  id: string
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string
  startDate?: string
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
  progressPercentage?: number
  taskType?: 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION'
  assignee?: {
    id: string
    name: string
    email: string
    image?: string
  }
  teamMembers?: Array<{ userId?: string; user?: { id: string; name?: string; email: string; image?: string } }>
  collaborators?: Array<{ userId?: string; user?: { id: string; name?: string; email: string; image?: string } }>
  assignees?: Array<{ userId?: string; user?: { id: string; name?: string; email: string; image?: string } }>
  creator?: {
    id: string
    name?: string
    email?: string
  }
  assignedBy?: {
    id: string
    name?: string
    email?: string
  }
  team?: {
    id: string
    name: string
  } | null
  createdAt: string
  updatedAt?: string
}

interface Team {
  id: string
  name: string
}

interface MemberWithStats {
  id: string
  email: string
  firstName?: string
  lastName?: string
  name: string
  image?: string
  role: string
  hierarchyLevel?: number
  contactNumber?: string
  positionTitle?: string
  isActive: boolean
  createdAt: string
  reportsToId: string
  taskCounts: {
    todo: number
    inProgress: number
    inReview: number
    total: number
  }
  priorityCounts: {
    urgent: number
    high: number
    medium: number
    low: number
  }
  overdueTasks: number
  availabilityScore: number
  workloadPercentage: number
  assignedTasks: Task[]
}

type ViewMode = 'list' | 'kanban'
type StatusFilter = 'all' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
type MemberSort = 'alerts' | 'workload' | 'tasks' | 'name'
type TaskSort = 'dueDate' | 'priority' | 'updated' | 'progress'

export default function MemberManagementPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMember, setSelectedMember] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false)
  const [viewingTask, setViewingTask] = useState<Task | null>(null)
  const [memberSuggestions, setMemberSuggestions] = useState<MemberWithStats[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [memberSort, setMemberSort] = useState<MemberSort>('alerts')
  const [taskSearch, setTaskSearch] = useState('')
  const [taskSort, setTaskSort] = useState<TaskSort>('dueDate')
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [taskTotal, setTaskTotal] = useState(0)

  useEffect(() => {
    if (session?.user?.role !== 'LEADER') {
      router.push('/user/dashboard')
    }
  }, [session])

  const fetchMemberSuggestions = async () => {
    if (!session?.user || session.user.role !== 'LEADER') return
    try {
      setSuggestionsLoading(true)
      const qs = teamFilter !== 'all' ? `?teamId=${encodeURIComponent(teamFilter)}` : ''
      const response = await fetch('/api/user/member-suggestions' + qs)
      if (!response.ok) throw new Error('Failed to fetch member suggestions')
      const data = await response.json()
      setMemberSuggestions(data.members || [])
    } catch (err) {
      console.error('Error fetching member suggestions:', err)
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const fetchData = async () => {
    if (!session?.user || session.user.role !== 'LEADER') return
    try {
      // The roster endpoint returns the leader's managed teams alongside the
      // members, so the filter's options and its results always come from the
      // same source of truth.
      const qs = teamFilter !== 'all' ? `?teamId=${encodeURIComponent(teamFilter)}` : ''
      const membersResponse = await fetch('/api/user/team-members' + qs)
      if (!membersResponse.ok) throw new Error('Failed to fetch data')
      const membersData = await membersResponse.json()
      const members = membersData.members || []
      setTeamMembers(members)
      if (membersData.teams) setTeams(membersData.teams)

      // Fetch the whole team's task set once: tasks the leader is involved in
      // plus every managed member's tasks (team tasks, individual tasks, each
      // with its subtasks). All per-member / aggregate narrowing happens
      // client-side in `filteredTasks`, so a member's involvement via team
      // membership or subtasks is surfaced — not only tasks where they are the
      // direct assignee. The page previously requested 100, which silently
      // truncated every aggregate for a team with more work than that; the
      // server caps at 1000, and the real total is kept so the UI can say when
      // it is still showing a partial set rather than quietly under-reporting.
      const taskParams = new URLSearchParams()
      taskParams.append('limit', '500')
      taskParams.append('includeManagedMembers', 'true')
      const tasksResponse = await fetch('/api/tasks?' + taskParams.toString())
      if (!tasksResponse.ok) throw new Error('Failed to fetch tasks')
      const tasksData = await tasksResponse.json()
      setTasks(tasksData.tasks || [])
      setTaskTotal(tasksData.pagination?.total ?? (tasksData.tasks || []).length)
    } catch (err) {
      console.error('Error fetching data:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  // Member selection narrows client-side (see filteredTasks); the team filter
  // is server-side, so changing it refetches.
  useEffect(() => { fetchData() }, [session, teamFilter])
  useEffect(() => {
    if (session?.user?.role === 'LEADER') fetchMemberSuggestions()
  }, [session, teamFilter])

  // Live updates: a leader watching this page sees a reassignment land instead
  // of waiting on a reload. Only for leaders — members are redirected away.
  useTaskRefresh(
    () => { fetchData(); fetchMemberSuggestions() },
    { enabled: session?.user?.role === 'LEADER' }
  )

  // Selecting a team can drop the currently-open member from the roster.
  useEffect(() => {
    if (selectedMember && !loading && !teamMembers.some(m => m.id === selectedMember)) {
      setSelectedMember('')
    }
  }, [teamMembers, selectedMember, loading])

  const handleDeleteTask = async () => {
    if (!deletingTask) return
    try {
      const response = await fetch(`/api/tasks/${deletingTask.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete task')
      }
      await fetchData()
      await fetchMemberSuggestions()
      setDeletingTask(null)
      toast({ title: 'Success', description: 'Task deleted successfully' })
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete task',
        variant: 'destructive'
      })
    }
  }

  // Mirror the server-side canDeleteTask (src/lib/permissions.ts:161-181):
  // ADMIN, the task creator, or a Leader who personally assigned the task.
  // The "team leader of the team" branch is omitted on the client since
  // teamMemberRole isn't plumbed through here; the trash icon is hidden in
  // that case (server still allows the delete if it were attempted directly).
  const canDeleteTask = (task: Task) => {
    if (session?.user?.role === 'ADMIN') return true
    if (task.creator?.id === session?.user?.id) return true
    if (
      session?.user?.role === 'LEADER' &&
      task.assignedBy?.id === session?.user?.id
    ) return true
    return false
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'bg-red-100 text-red-700 border-red-200'
      case 'HIGH':   return 'bg-orange-100 text-orange-700 border-orange-200'
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'LOW':    return 'bg-green-100 text-green-700 border-green-200'
      default:       return 'bg-slate-100 text-slate-700 border-slate-200'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':  return 'bg-emerald-100 text-emerald-700 border-emerald-300'
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-700 border-blue-300'
      case 'IN_REVIEW':  return 'bg-amber-100 text-amber-700 border-amber-300'
      case 'TODO':       return 'bg-slate-100 text-slate-700 border-slate-300'
      default:           return 'bg-slate-100 text-slate-700 border-slate-300'
    }
  }

  // The member picker filters live on `searchTerm` (small list; instant beats debounce).
  const filteredMembers = teamMembers.filter(member =>
    !searchTerm ||
    member.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const selectedMemberObj = teamMembers.find(m => m.id === selectedMember)

  // Per-member, server-computed stats (overdue/urgent/workload). Authoritative
  // per member — these can differ from the panel's teamStats, which derive from
  // the client-filtered task set. Used for the sidebar health badges + sorting.
  const statsFor = (memberId: string) => memberSuggestions.find(s => s.id === memberId)
  const alertScoreFor = (memberId: string) => {
    const s = statsFor(memberId)
    return (s?.overdueTasks ?? 0) * 10 + (s?.priorityCounts?.urgent ?? 0)
  }

  const sortedMembers = [...filteredMembers].sort((a, b) => {
    switch (memberSort) {
      case 'workload':
        return (statsFor(b.id)?.workloadPercentage ?? 0) - (statsFor(a.id)?.workloadPercentage ?? 0)
      case 'tasks':
        return (statsFor(b.id)?.taskCounts?.total ?? 0) - (statsFor(a.id)?.taskCounts?.total ?? 0)
      case 'name':
        return (a.name || a.email).localeCompare(b.name || b.email)
      case 'alerts':
      default: {
        const diff = alertScoreFor(b.id) - alertScoreFor(a.id)
        // Tie-break by workload so the list stays stable/meaningful when no alerts
        return diff !== 0 ? diff : (statsFor(b.id)?.workloadPercentage ?? 0) - (statsFor(a.id)?.workloadPercentage ?? 0)
      }
    }
  })

  // A member is "involved" in a task if they're the direct assignee, a team
  // member, a collaborator, or the assignee of one of its subtasks. This is why
  // a leader-owned TEAM task with subtasks delegated to a member still shows up
  // under that member (and in the team view) instead of being hidden.
  const taskInvolvesMember = (task: any, memberId: string): boolean =>
    task.assignee?.id === memberId ||
    (task.teamMembers?.some((tm: any) => (tm.user?.id ?? tm.userId) === memberId) ?? false) ||
    (task.collaborators?.some((c: any) => (c.user?.id ?? c.userId) === memberId) ?? false) ||
    (task.subtasks?.some((s: any) => s.assignee?.id === memberId) ?? false)

  const teamMemberIdSet = teamMembers.map(m => m.id)

  // Flat "Assigned To" — de-duped union of the (dual-written) assignee + team
  // members + collaborators. The people shown on a task card.
  const getTaskPeople = (task: Task): Array<{ id: string; name?: string; email: string; image?: string }> => {
    const map = new Map<string, { id: string; name?: string; email: string; image?: string }>()
    if (task.assignee) map.set(task.assignee.id, task.assignee)
    task.teamMembers?.forEach(m => { if (m.user) map.set(m.user.id, m.user) })
    task.collaborators?.forEach(c => { if (c.user) map.set(c.user.id, c.user) })
    return Array.from(map.values())
  }

  const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

  const filteredTasks = tasks
    .filter(task => {
      if (selectedMember) return taskInvolvesMember(task, selectedMember)
      // "All Team Tasks": any task a managed member is involved in, plus the
      // team / collaboration tasks the leader leads. The leader's own personal
      // (individual) tasks are excluded.
      return (
        teamMemberIdSet.some(id => taskInvolvesMember(task, id)) ||
        task.taskType === 'TEAM' ||
        task.taskType === 'COLLABORATION'
      )
    })
    .filter(task => statusFilter === 'all' || task.status === statusFilter)
    .filter(task => {
      const q = taskSearch.trim().toLowerCase()
      if (!q) return true
      return (
        task.title.toLowerCase().includes(q) ||
        (task.description?.toLowerCase().includes(q) ?? false) ||
        (task.assignee?.name?.toLowerCase().includes(q) ?? false)
      )
    })
    .sort((a, b) => {
      switch (taskSort) {
        case 'priority':
          return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
        case 'progress':
          return (b.progressPercentage ?? 0) - (a.progressPercentage ?? 0)
        case 'updated':
          return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
        case 'dueDate':
        default: {
          // Tasks with a due date first (soonest → latest); undated last.
          if (!a.dueDate && !b.dueDate) return 0
          if (!a.dueDate) return 1
          if (!b.dueDate) return -1
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        }
      }
    })

  // Inline status change from the task menu. Server enforces who may move a task
  // (canChangeTaskStatus + dependency blocks) — we attempt and surface its error.
  // Optimistic local update with rollback so a single click feels instant.
  const changeTaskStatus = async (task: Task, status: Task['status']) => {
    if (task.status === status) return
    const prev = task.status
    setUpdatingTaskId(task.id)
    setTasks(curr => curr.map(t => (t.id === task.id ? { ...t, status } : t)))
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update status')
      }
      // Reconcile with the server's updated task so derived fields stay accurate
      // (e.g. progressPercentage on completion, updatedAt for the "recently
      // updated" sort). Merge over the existing row to keep any fields the
      // response may omit. Falls back to the optimistic status if parsing fails.
      const updated = await res.json().catch(() => null)
      if (updated && updated.id) {
        setTasks(curr => curr.map(t => (t.id === task.id ? { ...t, ...updated } : t)))
      }
      // Refresh per-member health badges (overdue/urgent) in the background.
      fetchMemberSuggestions()
      toast({ title: 'Status updated', description: `Moved to ${status.replace(/_/g, ' ').toLowerCase()}` })
    } catch (e) {
      setTasks(curr => curr.map(t => (t.id === task.id ? { ...t, status: prev } : t)))
      toast({
        title: 'Could not update status',
        description: e instanceof Error ? e.message : 'Please try again',
        variant: 'destructive',
      })
    } finally {
      setUpdatingTaskId(null)
    }
  }

  const STATUS_OPTIONS: { value: Task['status']; label: string; dot: string }[] = [
    { value: 'TODO', label: 'To Do', dot: 'bg-slate-300' },
    { value: 'IN_PROGRESS', label: 'In Progress', dot: 'bg-blue-400' },
    { value: 'IN_REVIEW', label: 'In Review', dot: 'bg-amber-400' },
    { value: 'COMPLETED', label: 'Completed', dot: 'bg-emerald-400' },
  ]

  // Shared "Move to ▸" status submenu for the task action menus (list + kanban).
  const statusSubmenu = (task: Task) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {updatingTaskId === task.id
          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          : <ArrowRight className="h-4 w-4 mr-2" />}
        Move to
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {STATUS_OPTIONS.map(opt => (
          <DropdownMenuItem
            key={opt.value}
            disabled={updatingTaskId === task.id || task.status === opt.value}
            onClick={(e) => { e.stopPropagation(); changeTaskStatus(task, opt.value) }}
          >
            <span className={cn('h-2 w-2 rounded-full mr-2', opt.dot)} />
            {opt.label}
            {task.status === opt.value && (
              <span className="ml-auto pl-3 text-[10px] uppercase tracking-wide text-slate-400">current</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )

  const teamStats = {
    totalMembers: teamMembers.length,
    totalTasks: filteredTasks.length,
    inProgressTasks: filteredTasks.filter(t => t.status === 'IN_PROGRESS').length,
    completedTasks: filteredTasks.filter(t => t.status === 'COMPLETED').length,
    urgentTasks: filteredTasks.filter(t => t.priority === 'URGENT').length,
    overdueTasks: filteredTasks.filter(t => {
      const sot = new Date(); sot.setHours(0,0,0,0)
      return t.dueDate && new Date(t.dueDate) < sot && t.status !== 'COMPLETED'
    }).length
  }

  const kanbanColumns = [
    { id: 'TODO',        title: 'To Do',      icon: ListTodo,   accent: 'border-l-slate-400',  badge: 'bg-slate-100 text-slate-600' },
    { id: 'IN_PROGRESS', title: 'In Progress', icon: Activity,   accent: 'border-l-blue-400',   badge: 'bg-blue-100 text-blue-700' },
    { id: 'IN_REVIEW',   title: 'In Review',   icon: Eye,        accent: 'border-l-amber-400',  badge: 'bg-amber-100 text-amber-700' },
    { id: 'COMPLETED',   title: 'Completed',   icon: CheckSquare,accent: 'border-l-emerald-400',badge: 'bg-emerald-100 text-emerald-700' },
  ]

  if (session?.user?.role !== 'LEADER') return null

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading member data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Failed to load data</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchData}>Try Again</Button>
        </div>
      </div>
    )
  }

  const alertCount = teamStats.urgentTasks + teamStats.overdueTasks

  return (
    <div className="space-y-8">

      {/* ── Gradient Hero Header ── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-slate-50 to-purple-50 opacity-60" />
        <div className="relative backdrop-blur-sm bg-white/40 border border-slate-200/60 rounded-xl shadow-sm p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Member Management</h1>
              <p className="text-slate-600 text-base font-medium">
                Assign tasks, track workload, and optimize your team's performance.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Button
                className="shadow-sm"
                onClick={() => setIsCreateTaskDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Assign Task
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">

        {/* Team Members */}
        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-blue-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Team Members</CardTitle>
            <div className="p-2.5 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{teamStats.totalMembers}</div>
              <span className="text-sm text-slate-500 font-medium">members</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">Active team</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>

        {/* Total Tasks */}
        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-purple-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Total Tasks</CardTitle>
            <div className="p-2.5 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
              <Target className="h-5 w-5 text-purple-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{teamStats.totalTasks}</div>
              <span className="text-sm text-slate-500 font-medium">assigned</span>
            </div>
            {/* These cards aggregate the fetched page client-side. Past the page
                size the numbers are a partial view — say so rather than report
                a smaller figure as if it were the total. */}
            {tasks.length < taskTotal && (
              <p className="text-[11px] text-amber-600 font-medium">
                Showing {tasks.length} of {taskTotal} — totals are partial
              </p>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">In progress</span>
                <span className="text-slate-900 font-semibold">{teamStats.inProgressTasks}</span>
              </div>
              <Progress
                value={teamStats.totalTasks > 0 ? (teamStats.inProgressTasks / teamStats.totalTasks) * 100 : 0}
                className="h-1.5 bg-slate-100"
              />
            </div>
          </CardContent>
        </Card>

        {/* Completed */}
        <Card className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Completed</CardTitle>
            <div className="p-2.5 bg-emerald-50 rounded-lg group-hover:bg-emerald-100 transition-colors">
              <Award className="h-5 w-5 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{teamStats.completedTasks}</div>
              <span className="text-sm text-slate-500 font-medium">done</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">Tasks finished</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className={cn(
          "group relative overflow-hidden border bg-white hover:shadow-lg transition-all duration-300 rounded-xl hover:-translate-y-1",
          alertCount > 0 ? "border-red-200" : "border-slate-200"
        )}>
          <div className={cn("absolute top-0 left-0 w-full h-1 bg-gradient-to-r", alertCount > 0 ? "from-red-500 to-red-600" : "from-slate-400 to-slate-500")} />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Alerts</CardTitle>
            <div className={cn("p-2.5 rounded-lg transition-colors", alertCount > 0 ? "bg-red-50 group-hover:bg-red-100" : "bg-slate-50 group-hover:bg-slate-100")}>
              <AlertTriangle className={cn("h-5 w-5", alertCount > 0 ? "text-red-500" : "text-slate-400")} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className={cn("text-4xl font-bold", alertCount > 0 ? "text-red-600" : "text-slate-400")}>{alertCount}</div>
              <span className="text-sm text-slate-500 font-medium">issues</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">{teamStats.urgentTasks} urgent · {teamStats.overdueTasks} overdue</span>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* ── Member workspace ── */}
      <div className="flex flex-col gap-4 md:h-[calc(100vh-340px)] min-h-[520px]">

        {/* Member search — pick a member to open their board */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
          <Popover open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (o) setSearchTerm('') }}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="w-full sm:w-[380px] justify-between h-11 rounded-xl border-slate-200 bg-white px-3 font-normal hover:bg-slate-50"
              >
                {selectedMemberObj ? (
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={selectedMemberObj.image} />
                      <AvatarFallback className="bg-blue-100 text-blue-700 text-[11px] font-bold">
                        {(selectedMemberObj.name || selectedMemberObj.email).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-slate-900 truncate">{selectedMemberObj.name || selectedMemberObj.email}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-slate-500 min-w-0">
                    <Search className="h-4 w-4 shrink-0" />
                    <span className="truncate">Search a member to open their board…</span>
                  </span>
                )}
                <ChevronsUpDown className="h-4 w-4 text-slate-400 shrink-0 ml-2" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden z-[200]">
              <div className="p-2 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    autoFocus
                    placeholder="Type a name…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 h-9 border-slate-200 text-sm"
                  />
                </div>
              </div>
              <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5">
                {/* All team tasks */}
                <button
                  className={cn(
                    "w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2.5 transition-colors",
                    !selectedMember ? "bg-blue-50" : "hover:bg-slate-50"
                  )}
                  onClick={() => { setSelectedMember(''); setPickerOpen(false) }}
                >
                  <span className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <Users className="h-4 w-4 text-slate-500" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-700">All team tasks</span>
                    <span className="block text-xs text-slate-400">{teamStats.totalMembers} members · {teamStats.totalTasks} tasks</span>
                  </span>
                </button>

                {sortedMembers.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">No members match</div>
                ) : (
                  sortedMembers.map((member) => {
                    const stats = memberSuggestions.find(s => s.id === member.id)
                    const workload = stats?.workloadPercentage ?? 0
                    const overdue = stats?.overdueTasks ?? 0
                    const urgent = stats?.priorityCounts?.urgent ?? 0
                    const isSelected = selectedMember === member.id
                    const initials = member.name
                      ? member.name.split(' ').map(n => n[0]).join('').slice(0, 2)
                      : member.email[0].toUpperCase()
                    return (
                      <button
                        key={member.id}
                        className={cn(
                          "w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2.5 transition-colors",
                          isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                        )}
                        onClick={() => { setSelectedMember(member.id); setPickerOpen(false) }}
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={member.image} />
                          <AvatarFallback className={cn("text-xs font-bold", isSelected ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600")}>
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn("text-sm font-semibold truncate", isSelected ? "text-blue-900" : "text-slate-800")}>
                              {member.name || 'Unnamed User'}
                            </span>
                            {/* Team-only people used to be absent from this list
                                entirely; the badge makes their origin explicit. */}
                            {member.sources?.includes('team') && !member.sources?.includes('reports-to') && (
                              <span
                                className="text-[10px] font-semibold shrink-0 text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5"
                                title={`From team: ${(member.teams || []).map(t => t.name).join(', ')}`}
                              >
                                Team
                              </span>
                            )}
                            <span className={cn(
                              "text-[11px] font-semibold shrink-0 tabular-nums",
                              workload >= 80 ? "text-red-500" : workload >= 50 ? "text-amber-500" : "text-emerald-600"
                            )}>
                              {workload}%
                            </span>
                          </div>
                          {(overdue > 0 || urgent > 0) && (
                            <div className="flex items-center gap-1.5 mt-1">
                              {overdue > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                                  <AlertTriangle className="h-3 w-3" /> {overdue} overdue
                                </span>
                              )}
                              {urgent > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                                  <AlertCircle className="h-3 w-3" /> {urgent} urgent
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>

          {teams.length > 0 && (
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="w-full sm:w-[220px] h-11 rounded-xl border-slate-200 bg-white">
                <SelectValue placeholder="All members" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value="all">All members</SelectItem>
                {teams.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {selectedMember && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-slate-500 hover:text-slate-900 gap-1.5 self-start sm:self-auto"
              onClick={() => setSelectedMember('')}
            >
              <X className="h-3.5 w-3.5" /> Back to all team tasks
            </Button>
          )}
        </div>

          {/* Selected Member Profile Strip */}
          {selectedMember && (() => {
            const profileMember = teamMembers.find(m => m.id === selectedMember)
            const profileStats = memberSuggestions.find(s => s.id === selectedMember)
            const profileWorkload = profileStats?.workloadPercentage ?? 0
            const profileActive = profileStats?.taskCounts?.inProgress ?? 0
            const profileTotal = profileStats?.taskCounts?.total ?? 0
            if (!profileMember) return null
            const initials = profileMember.name
              ? profileMember.name.split(' ').map(n => n[0]).join('').slice(0, 2)
              : profileMember.email[0].toUpperCase()
            return (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3.5 flex items-center gap-4 shrink-0">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={profileMember.image} />
                  <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{profileMember.name || 'Unnamed User'}</p>
                  <div className="flex items-center gap-4 text-xs text-slate-500 mt-0.5">
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />{profileActive} active
                    </span>
                    <span className="flex items-center gap-1">
                      <Target className="h-3 w-3" />{profileTotal} total
                    </span>
                    <span className={cn("flex items-center gap-1 font-semibold", profileWorkload >= 80 ? "text-red-500" : profileWorkload >= 50 ? "text-amber-500" : "text-emerald-600")}>
                      <BarChart3 className="h-3 w-3" />{profileWorkload}% workload
                    </span>
                  </div>
                </div>
                <Button size="sm" className="shrink-0" onClick={() => setIsCreateTaskDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Assign Task
                </Button>
              </div>
            )
          })()}

          {/* Task Panel */}
          <Card className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">

            {/* Task Panel Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/40 flex flex-col gap-3 shrink-0">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900 truncate">
                    {selectedMember
                      ? `${teamMembers.find(m => m.id === selectedMember)?.name || 'Member'}'s Tasks`
                      : 'All Team Tasks'
                    }
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
                    {statusFilter !== 'all' ? ` · ${statusFilter.replace(/_/g, ' ')}` : ' · all statuses'}
                    {taskSearch.trim() ? ' · filtered' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
                    <SelectTrigger className="w-[140px] border-slate-200 rounded-lg bg-white text-sm h-9">
                      <div className="flex items-center gap-2">
                        <Filter className="h-3.5 w-3.5 text-slate-400" />
                        <SelectValue placeholder="All Status" />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="TODO">To Do</SelectItem>
                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="IN_REVIEW">In Review</SelectItem>
                      <SelectItem value="COMPLETED">Completed</SelectItem>
                    </SelectContent>
                  </Select>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="rounded-lg border-slate-200 bg-white h-9 w-9">
                        <MoreHorizontal className="h-4 w-4 text-slate-500" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-lg">
                      <DropdownMenuLabel className="text-xs font-semibold text-slate-500 uppercase tracking-wide">View Mode</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setViewMode('list')}>
                        <ListTodo className="h-4 w-4 mr-2" /> List View
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setViewMode('kanban')}>
                        <BarChart3 className="h-4 w-4 mr-2" /> Kanban Board
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Search + sort row */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Search these tasks..."
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    className="pl-9 border-slate-200 rounded-lg bg-white text-sm h-9"
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 px-3 gap-1.5 border-slate-200 bg-white text-slate-600 shrink-0">
                      <ArrowUpDown className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">
                        {taskSort === 'dueDate' ? 'Due date'
                          : taskSort === 'priority' ? 'Priority'
                          : taskSort === 'updated' ? 'Recently updated'
                          : 'Progress'}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="rounded-lg">
                    <DropdownMenuLabel className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sort tasks by</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={taskSort} onValueChange={(v) => setTaskSort(v as TaskSort)}>
                      <DropdownMenuRadioItem value="dueDate">Due date (soonest)</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="priority">Priority (urgent first)</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="updated">Recently updated</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="progress">Progress (high first)</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Task Content — scrollable */}
            <div className="flex-1 overflow-y-auto p-5 bg-slate-50/30">
              {filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[260px] text-center">
                  <div className="p-4 bg-slate-100 rounded-full mb-4">
                    <CheckSquare className="h-10 w-10 text-slate-300" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-600 mb-1">No tasks found</h3>
                  <p className="text-sm text-slate-400 mb-6 max-w-xs">
                    {taskSearch.trim()
                      ? `No tasks match "${taskSearch.trim()}"`
                      : selectedMember
                      ? 'This member has no assigned tasks yet'
                      : statusFilter !== 'all'
                      ? `No tasks with status "${statusFilter.replace(/_/g, ' ')}"`
                      : 'No tasks have been assigned to team members yet'
                    }
                  </p>
                  {taskSearch.trim() ? (
                    <Button onClick={() => setTaskSearch('')} size="sm" variant="outline">
                      Clear search
                    </Button>
                  ) : (
                    <Button onClick={() => setIsCreateTaskDialogOpen(true)} size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      {selectedMember ? 'Assign First Task' : 'Create First Task'}
                    </Button>
                  )}
                </div>

              ) : viewMode === 'list' ? (
                <div className="space-y-2.5">
                  {filteredTasks.map((task) => {
                    const sot = new Date(); sot.setHours(0,0,0,0)
                    const isOverdue = task.dueDate && new Date(task.dueDate) < sot && task.status !== 'COMPLETED'
                    const progress = task.progressPercentage ?? 0
                    return (
                      <div
                        key={task.id}
                        className={cn(
                          "group relative bg-white rounded-xl border border-slate-200 border-l-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer",
                          task.status === 'COMPLETED'  ? "border-l-emerald-400" :
                          task.status === 'IN_PROGRESS'? "border-l-blue-400"    :
                          task.status === 'IN_REVIEW'  ? "border-l-amber-400"   : "border-l-slate-300"
                        )}
                        onClick={() => setViewingTask(task)}
                      >
                        <div className="p-4">
                          {/* Row 1: Title + menu */}
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-semibold text-slate-900 leading-snug">{task.title}</h4>
                              {task.description && (
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0 rounded-lg"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-4 w-4 text-slate-400" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewingTask(task) }}>
                                  <Eye className="h-4 w-4 mr-2" /> View Details
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {statusSubmenu(task)}
                                {canDeleteTask(task) && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-red-600 focus:text-red-600"
                                      onClick={(e) => { e.stopPropagation(); setDeletingTask(task) }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Row 2: Badges + meta */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className={cn("text-[10px] px-1.5 h-5 border font-medium", getPriorityColor(task.priority))}>
                                {task.priority}
                              </Badge>
                              <Badge className={cn("text-[10px] px-1.5 h-5 border font-medium", getStatusColor(task.status))}>
                                {task.status.replace(/_/g, ' ')}
                              </Badge>
                              {isOverdue && (
                                <Badge className="text-[10px] px-1.5 h-5 bg-red-50 text-red-600 border border-red-200 font-medium">
                                  Overdue
                                </Badge>
                              )}
                              {task.dueDate && (
                                <span className={cn("text-xs flex items-center gap-1", isOverdue ? "text-red-500 font-medium" : "text-slate-400")}>
                                  <Clock className="h-3 w-3" />
                                  {format(new Date(task.dueDate), 'MMM d, yyyy')}
                                </span>
                              )}
                            </div>
                            {(() => {
                              const people = getTaskPeople(task)
                              if (people.length === 0) return null
                              return (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="flex -space-x-1">
                                    {people.slice(0, 4).map(p => (
                                      <Avatar key={p.id} className="h-5 w-5 border border-white">
                                        <AvatarImage src={p.image || undefined} />
                                        <AvatarFallback className="bg-blue-100 text-blue-700 text-[9px] font-bold">
                                          {p.name ? p.name.split(' ').map(n => n[0]).join('') : p.email[0].toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                    ))}
                                    {people.length > 4 && (
                                      <div className="h-5 w-5 rounded-full bg-slate-100 border border-white flex items-center justify-center text-[9px] font-bold text-slate-500">
                                        +{people.length - 4}
                                      </div>
                                    )}
                                  </div>
                                  {people.length === 1 && (
                                    <span className="text-xs text-slate-500 truncate max-w-[100px]">
                                      {people[0].name || people[0].email}
                                    </span>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {/* Progress bar */}
                          {progress > 0 && (
                            <div className="mt-2.5">
                              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                                <span>Progress</span><span>{progress}%</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full transition-all", progress >= 75 ? "bg-emerald-500" : progress >= 40 ? "bg-blue-500" : "bg-amber-500")}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

              ) : (
                /* Kanban Board */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
                  {kanbanColumns.map((column) => {
                    const columnTasks = filteredTasks.filter(task => task.status === column.id)
                    const Icon = column.icon
                    return (
                      <div key={column.id} className="flex flex-col gap-2.5">
                        <div className={cn("flex items-center justify-between px-3 py-2 rounded-lg border-l-4 bg-white border border-slate-200 shadow-sm", column.accent)}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-slate-500" />
                            <span className="text-sm font-semibold text-slate-700">{column.title}</span>
                          </div>
                          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", column.badge)}>
                            {columnTasks.length}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {columnTasks.length === 0 ? (
                            <div className="text-center py-8 text-slate-400 text-xs bg-white rounded-lg border border-dashed border-slate-200">
                              No tasks
                            </div>
                          ) : (
                            columnTasks.map((task) => (
                              <div
                                key={task.id}
                                className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group p-3.5 space-y-2.5"
                                onClick={() => setViewingTask(task)}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <h4 className="text-sm font-semibold text-slate-900 line-clamp-2 flex-1 leading-snug">{task.title}</h4>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 shrink-0 rounded-lg" onClick={e => e.stopPropagation()}>
                                        <MoreHorizontal className="h-3 w-3 text-slate-400" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewingTask(task) }}>
                                        <Eye className="h-4 w-4 mr-2" /> View
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      {statusSubmenu(task)}
                                      {canDeleteTask(task) && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem className="text-red-600" onClick={(e) => { e.stopPropagation(); setDeletingTask(task) }}>
                                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                <Badge className={cn("text-[10px] px-1.5 h-5 border font-medium", getPriorityColor(task.priority))}>
                                  {task.priority}
                                </Badge>
                                {task.dueDate && (
                                  <p className="text-xs text-slate-400 flex items-center gap-1">
                                    <Clock className="h-3 w-3" /> {format(new Date(task.dueDate), 'MMM d')}
                                  </p>
                                )}
                                {(task.progressPercentage ?? 0) > 0 && (
                                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${task.progressPercentage}%` }} />
                                  </div>
                                )}
                                {(() => {
                                  const people = getTaskPeople(task)
                                  if (people.length === 0) return null
                                  return (
                                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                                      <div className="flex -space-x-1">
                                        {people.slice(0, 4).map(p => (
                                          <Avatar key={p.id} className="h-5 w-5 border border-white">
                                            <AvatarImage src={p.image || undefined} />
                                            <AvatarFallback className="bg-blue-100 text-blue-700 text-[9px] font-bold">
                                              {p.name ? p.name.split(' ').map(n => n[0]).join('') : p.email[0].toUpperCase()}
                                            </AvatarFallback>
                                          </Avatar>
                                        ))}
                                        {people.length > 4 && (
                                          <div className="h-5 w-5 rounded-full bg-slate-100 border border-white flex items-center justify-center text-[9px] font-bold text-slate-500">
                                            +{people.length - 4}
                                          </div>
                                        )}
                                      </div>
                                      {people.length === 1 && (
                                        <span className="text-xs text-slate-500 truncate">{people[0].name || people[0].email}</span>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>
      </div>

      {/* ── Assign Task ── */}
      {isCreateTaskDialogOpen && (
        <TaskForm
          open={isCreateTaskDialogOpen}
          preSelectedMemberId={selectedMember || undefined}
          onOpenChange={(open) => setIsCreateTaskDialogOpen(open)}
          onSubmit={async (data: any) => {
            try {
              // POST /api/tasks does not handle a `subtasks` array — it would be
              // silently dropped. Create the parent task first, then create each
              // subtask separately with parentId (same pattern as /user/tasks).
              const { subtasks, ...mainTaskData } = data

              const response = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mainTaskData),
              })
              if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || 'Failed to create task')
              }

              const newTask = await response.json()
              // Recurring tasks return { firstInstance }; regular tasks return the task directly
              const parentTaskId = newTask.id ?? newTask.firstInstance?.id

              if (subtasks && subtasks.length > 0 && parentTaskId) {
                await Promise.all(
                  subtasks.map((subtask: { title: string; assigneeId: string }) =>
                    fetch('/api/tasks', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        title: subtask.title,
                        parentId: parentTaskId,
                        priority: mainTaskData.priority,
                        taskType: 'INDIVIDUAL',
                        assigneeId: subtask.assigneeId,
                      }),
                    })
                  )
                )
              }

              const subtaskCount = subtasks?.length || 0
              toast({
                title: 'Success',
                description: subtaskCount > 0
                  ? `Task assigned with ${subtaskCount} subtask${subtaskCount !== 1 ? 's' : ''}`
                  : 'Task assigned successfully',
              })
              setIsCreateTaskDialogOpen(false)
              fetchData()
              fetchMemberSuggestions()
            } catch (err: any) {
              toast({ title: 'Error', description: err.message || 'Failed to assign task', variant: 'destructive' })
              throw err
            }
          }}
        />
      )}

      {/* ── Task Detail Modal ── */}
      <TaskViewModal
        open={!!viewingTask}
        onOpenChange={(open) => { if (!open) setViewingTask(null) }}
        task={viewingTask as any}
        onTaskUpdate={() => { fetchData(); fetchMemberSuggestions() }}
      />

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={!!deletingTask} onOpenChange={() => setDeletingTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingTask?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Delete Task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
