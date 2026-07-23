'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import {
  Plus,
  ListChecks,
  Search,
  Filter,
  Calendar,
  Clock,
  User,
  Users,
  Handshake,
  AlertCircle,
  CheckSquare,
  MoreHorizontal,
  Edit,
  Eye,
  Trash2,
  RefreshCw,
  ListTodo,
  Copy,
  UserPlus,
  Settings2,
  GitBranch,
  MessageSquare,
  Star,
  Video,
  Download,
  Archive,
  RotateCcw,
  ChevronDown,
  Tag,
  FolderInput,
  X,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserAvatar } from '@/components/shared/UserAvatar'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select'
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
import { cn } from '@/lib/utils'
import { format, isAfter, subDays } from 'date-fns'
import TaskForm from '@/components/tasks/TaskForm'
import TaskViewModal from '@/components/tasks/TaskViewModal'
import { ScheduleHealthBadge } from '@/components/tasks/ScheduleHealthBadge'
import TimelineView from '@/components/tasks/TimelineView'
import type { TimelineZoom } from '@/lib/timeline'
import DuplicateTaskDialog from '@/components/tasks/DuplicateTaskDialog'
import { MoveToBoardDialog } from '@/components/tasks/MoveToBoardDialog'
import { BulkTaskActionsDialog } from '@/components/tasks/bulk-task-actions-dialog'
import BoardSettingsDialog from '@/components/tasks/BoardSettingsDialog'
import { getScheduleHealth } from '@/lib/schedule-health'

interface Task {
  id: string
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string
  startDate?: string
  memberSubmittedAt?: string | null
  leaderEvaluatedAt?: string | null
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
  customStatusId?: string | null
  progressPercentage: number
  taskType: 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION' | 'CASCADING'
  parentId?: string | null
  boardId?: string | null
  viewerCanComplete?: boolean
  viewerCanChangeStatus?: boolean
  // Google Calendar fields
  location?: string
  meetingLink?: string
  allDay?: boolean
  recurrence?: string
  reminders?: any
  // Recurring task
  recurringParentId?: string | null
  taskWeight?: number | null
  slaHours?: number | null
  assignee?: {
    id: string
    name: string
    email: string
    image?: string
  }
  creator?: {
    id: string
    name: string
    email: string
    image?: string
  }
  assignedBy?: {
    id: string
    name: string
    email: string
    image?: string
  }
  board?: {
    ownerId: string
  } | null
  assignees?: Array<{
    userId: string
    user: {
      id: string
      name: string
      email: string
      image?: string
    }
  }>
  team?: {
    id: string
    name: string
  }
  teamMembers?: Array<{
    userId: string
    user: {
      id: string
      name: string
      email: string
      image?: string
    }
    role: string
  }>
  collaborators?: Array<{
    userId: string
    user: {
      id: string
      name: string
      email: string
      image?: string
    }
  }>
  subtasks?: Array<{
    id: string
    title: string
    status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    progressPercentage: number
    dueDate?: string
    cascadeOrder?: number | null
    isLocked?: boolean
    assignee?: {
      id: string
      name: string
      email: string
      image?: string
    }
  }>
  _count?: {
    subtasks: number
    comments: number
  }
  createdAt: string
  updatedAt: string
}

interface User {
  id: string
  name: string
  email: string
  image?: string
}

interface BoardMemberUser {
  id: string
  name: string
  email: string
  image?: string
  role?: string
}

interface BoardStatus {
  id: string
  name: string
  category: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED'
  color: string
  position: number
  isDefault: boolean
}

interface BoardField {
  id: string
  name: string
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'
  options: string[]
  required: boolean
  position: number
}

interface KanbanBoard {
  id: string
  name: string
  description?: string
  color: string
  ownerId: string
  owner?: BoardMemberUser
  members: { userId: string; user: BoardMemberUser }[]
  _count: { tasks: number }
  team?: {
    id: string
    name: string
    members?: { userId: string; role: string; user: BoardMemberUser }[]
  } | null
  statuses?: BoardStatus[]
  fields?: BoardField[]
  canManage?: boolean
  isStarred?: boolean
  category?: string | null
}

// Kanban board pagination: fetch this many tasks per "page", with a Load more
// button to pull the next batch. Avoids the old default-10 cap silently hiding
// tasks beyond the first page.
const PAGE_SIZE = 50

const COLUMN_CONFIG = {
  BACKLOG: { title: 'Backlog', color: 'bg-slate-100', textColor: 'text-slate-600' },
  TODO: { title: 'To Do', color: 'bg-gray-100', textColor: 'text-gray-700' },
  IN_PROGRESS: { title: 'In Progress', color: 'bg-blue-100', textColor: 'text-blue-700' },
  IN_REVIEW: { title: 'In Review', color: 'bg-yellow-100', textColor: 'text-yellow-700' },
  COMPLETED: { title: 'Completed', color: 'bg-green-100', textColor: 'text-green-700' },
}

// The status categories rendered as columns. BACKLOG and CANCELLED are never
// columns — Backlog is a hidden archive (its own panel), not a board column.
// Used to tell an "All Tasks" category column (key === category) apart from a
// custom board-status column (key === BoardStatus id).
const CATEGORY_KEYS = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'] as const

type KanbanColumn = {
  key: string                 // BoardStatus id (board view) or category (All Tasks)
  title: string
  category: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
  isDefault: boolean
  color?: string              // hex accent for custom statuses
  headerClass: string         // tailwind bg (identical to before for defaults)
  textClass: string
}

const DEFAULT_COLUMNS: KanbanColumn[] = CATEGORY_KEYS.map((cat) => ({
  key: cat,
  title: COLUMN_CONFIG[cat].title,
  category: cat,
  isDefault: true,
  headerClass: COLUMN_CONFIG[cat].color,
  textClass: COLUMN_CONFIG[cat].textColor,
}))

const BOARD_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
  '#6366F1', '#14B8A6', '#84CC16', '#EAB308', '#22C55E', '#0EA5E9', '#A855F7', '#F43F5E',
  '#D946EF', '#DC2626', '#64748B', '#78716C',
]

// Format a Date as a local YYYY-MM-DD string (matches <input type="date">).
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Due-date range filter: quick presets plus a custom From/To picker, surfaced
 * as a popover in the filter bar. Commits the selected range to the parent via
 * onChange; the parent passes it to the tasks API as dueDateFrom/dueDateTo.
 */
function DueDateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const active = !!(from || to)

  // Re-seed the draft inputs from the committed value whenever the popover opens.
  useEffect(() => {
    if (open) {
      setDraftFrom(from)
      setDraftTo(to)
    }
  }, [open, from, to])

  const applyPreset = (preset: 'overdue' | 'today' | 'week' | 'month') => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let f = ''
    let t = ''
    if (preset === 'overdue') {
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      t = ymd(yesterday) // anything due before today
    } else if (preset === 'today') {
      f = ymd(today)
      t = ymd(today)
    } else if (preset === 'week') {
      // Monday–Sunday of the current week.
      const monday = new Date(today)
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      f = ymd(monday)
      t = ymd(sunday)
    } else {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      f = ymd(first)
      t = ymd(last)
    }
    onChange(f, t)
    setOpen(false)
  }

  const label = !active
    ? 'Due date'
    : from && to
      ? `${from} → ${to}`
      : from
        ? `From ${from}`
        : `Until ${to}`

  const PRESETS = [
    ['overdue', 'Overdue'],
    ['today', 'Today'],
    ['week', 'This week'],
    ['month', 'This month'],
  ] as const

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`w-full sm:w-auto justify-start gap-2 ${active ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100' : ''}`}
        >
          <Calendar className="h-4 w-4 shrink-0" />
          <span className="truncate max-w-[170px]">{label}</span>
          {active && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear due date filter"
              className="ml-1 rounded-sm opacity-60 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange('', '') }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChange('', '') } }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="text-xs font-semibold text-gray-500 mb-2">Filter by due date</p>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {PRESETS.map(([key, lbl]) => (
            <Button key={key} type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => applyPreset(key)}>
              {lbl}
            </Button>
          ))}
        </div>
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="due-from" className="w-10 text-xs text-gray-500">From</Label>
            <Input id="due-from" type="date" value={draftFrom} max={draftTo || undefined} onChange={(e) => setDraftFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="due-to" className="w-10 text-xs text-gray-500">To</Label>
            <Input id="due-to" type="date" value={draftTo} min={draftFrom || undefined} onChange={(e) => setDraftTo(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
        <div className="flex justify-between gap-2 mt-3">
          <Button type="button" variant="ghost" size="sm" className="text-gray-500" onClick={() => { onChange('', ''); setOpen(false) }}>
            Clear
          </Button>
          <Button type="button" size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { onChange(draftFrom, draftTo); setOpen(false) }}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function TasksPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Board pagination. `pagesRef` is the source of truth for how many PAGE_SIZE
  // batches are loaded, so every fetchTasks() caller (background refresh,
  // post-mutation refetch) re-fetches the same count instead of collapsing to 50.
  const pagesRef = useRef(1)
  const [totalTasks, setTotalTasks] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  // Initialize filter state from URL so /user/tasks?q=…&team=…&user=…&type=…&board=…
  // is bookmarkable and survives the back button.
  const [searchTerm, setSearchTerm] = useState<string>(() => searchParams.get('q') ?? '')
  const [selectedTeam, setSelectedTeam] = useState<string>(() => searchParams.get('team') ?? '')
  const [selectedUser, setSelectedUser] = useState<string>(() => searchParams.get('user') ?? '')
  // Due-date range filter (YYYY-MM-DD strings; '' = unset). Server-side, so it
  // works across all pages of a board rather than only the loaded ones.
  const [dueDateFrom, setDueDateFrom] = useState<string>(() => searchParams.get('from') ?? '')
  const [dueDateTo, setDueDateTo] = useState<string>(() => searchParams.get('to') ?? '')

  const [users, setUsers] = useState<User[]>([])
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [quickAddStatus, setQuickAddStatus] = useState<'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | undefined>(undefined)
  const [quickAddCustomStatusId, setQuickAddCustomStatusId] = useState<string | undefined>(undefined)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [showBacklog, setShowBacklog] = useState(false)
  // Board switcher: search + recently-opened boards (recents persist per browser).
  const [showBoardSwitcher, setShowBoardSwitcher] = useState(false)
  const [boardSearch, setBoardSearch] = useState('')
  const [recentBoardIds, setRecentBoardIds] = useState<string[]>([])
  const [categoryEditId, setCategoryEditId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem('tms:recentBoards') || '[]')
      if (Array.isArray(r)) setRecentBoardIds(r.filter((x): x is string => typeof x === 'string'))
    } catch { /* ignore */ }
  }, [])

  const [exporting, setExporting] = useState(false)
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [duplicatingTask, setDuplicatingTask] = useState<Task | null>(null)
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)
  const [movingTask, setMovingTask] = useState<Task | null>(null)
  const [pendingDuplicateTask, setPendingDuplicateTask] = useState<Task | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [deleteScope, setDeleteScope] = useState<'single' | 'series'>('single')
  const [viewingTask, setViewingTask] = useState<Task | null>(null)
  const [showViewModal, setShowViewModal] = useState(false)
  const [taskHistory, setTaskHistory] = useState<Task[]>([])

  const [viewMode, setViewMode] = useState<'board' | 'timeline'>(
    () => (searchParams.get('view') === 'timeline' ? 'timeline' : 'board')
  )
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoom>('month')

  // Board state
  const [boards, setBoards] = useState<KanbanBoard[]>([])
  const [activeBoardId, setActiveBoardId] = useState<string | null>(() => searchParams.get('board') || null) // null = "All Tasks"
  const [showCreateBoard, setShowCreateBoard] = useState(false)
  const [boardPendingDelete, setBoardPendingDelete] = useState<KanbanBoard | null>(null)
  const [deletingBoard, setDeletingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardColor, setNewBoardColor] = useState('#3B82F6')
  const [newBoardDescription, setNewBoardDescription] = useState('')
  const [newBoardMemberIds, setNewBoardMemberIds] = useState<string[]>([])
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [editingBoard, setEditingBoard] = useState<KanbanBoard | null>(null)
  const [editingBoardMemberIds, setEditingBoardMemberIds] = useState<string[]>([])

  // Open task modal from URL query param (e.g., from notification click)
  const openTaskFromUrl = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`)
      if (response.ok) {
        const task = await response.json()
        setViewingTask(task)
        setShowViewModal(true)
      }
    } catch (err) {
      console.error('Error fetching task from URL:', err)
    }
    // Clean up the URL param
    router.replace('/user/tasks', { scroll: false })
  }, [router])

  useEffect(() => {
    const taskId = searchParams.get('taskId')
    if (taskId && session?.user) {
      openTaskFromUrl(taskId)
    }
  }, [searchParams, session, openTaskFromUrl])

  const fetchTasks = async (showLoadingSpinner = true) => {
    if (!session?.user) return

    try {
      // Only show loading spinner on initial load, not background refreshes
      if (showLoadingSpinner) {
        setLoading(true)
      }
      setError(null)
      const params = new URLSearchParams()
      if (selectedTeam) params.append('teamId', selectedTeam)
      if (selectedUser) params.append('userId', selectedUser)
      if (dueDateFrom) params.append('dueDateFrom', dueDateFrom)
      if (dueDateTo) params.append('dueDateTo', dueDateTo)

      if (activeBoardId) params.append('boardId', activeBoardId)
      // Fetch all currently-loaded pages in one request so refreshes preserve
      // what the user has loaded via "Load more".
      params.append('limit', String(PAGE_SIZE * pagesRef.current))

      const response = await fetch(`/api/tasks?${params}`)

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Fetch tasks error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch tasks')
      }

      const data = await response.json()
      setTasks(data.tasks || [])
      setTotalTasks(data.pagination?.total ?? (data.tasks?.length || 0))
      setHasLoadedOnce(true)
    } catch (err) {
      console.error('Error fetching tasks:', err)
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      if (showLoadingSpinner) {
        setLoading(false)
      }
    }
  }

  // Export the current board (or All Tasks) to .xlsx, respecting the active
  // board, user filter, and search.
  const handleExport = async () => {
    try {
      setExporting(true)
      const params = new URLSearchParams()
      if (activeBoardId) params.append('boardId', activeBoardId)
      if (selectedUser) params.append('userId', selectedUser)
      if (dueDateFrom) params.append('dueDateFrom', dueDateFrom)
      if (dueDateTo) params.append('dueDateTo', dueDateTo)
      if (searchTerm.trim()) params.append('search', searchTerm.trim())
      const res = await fetch(`/api/tasks/export?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tasks-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast({ title: 'Export failed', description: 'Could not export tasks. Please try again.', variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const loadMore = async () => {
    pagesRef.current += 1
    setLoadingMore(true)
    await fetchTasks(false)
    setLoadingMore(false)
  }

  useEffect(() => {
    pagesRef.current = 1 // reset pagination when the filter/board changes
    fetchTasks()
    // Depend on session?.user?.id (a stable primitive) rather than the full
    // session object — NextAuth's refetchOnWindowFocus changes the session
    // reference on alt-tab even when identity is unchanged. The previous
    // `[session, ...]` deps re-fired this effect, flipping `loading` to true
    // and unmounting the TaskForm dialog (and its in-progress RHF state).
  }, [session?.user?.id, selectedTeam, selectedUser, activeBoardId, dueDateFrom, dueDateTo])

  // Refetch tasks when page becomes visible (e.g., navigating back from Calendar)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && session?.user) {
        fetchTasks(false) // Background refresh without loading spinner
      }
    }

    const handleFocus = () => {
      if (session?.user) {
        fetchTasks(false) // Background refresh without loading spinner
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [session?.user?.id])

  // Sync filter state to the URL so views are bookmarkable / back-button-friendly.
  // Uses replace (not push) so each keystroke doesn't create a history entry.
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchTerm) params.set('q', searchTerm)
    if (selectedTeam) params.set('team', selectedTeam)
    if (selectedUser) params.set('user', selectedUser)
    if (dueDateFrom) params.set('from', dueDateFrom)
    if (dueDateTo) params.set('to', dueDateTo)
    if (activeBoardId) params.set('board', activeBoardId)
    if (viewMode === 'timeline') params.set('view', 'timeline')
    const qs = params.toString()
    router.replace(qs ? `/user/tasks?${qs}` : '/user/tasks', { scroll: false })
  }, [searchTerm, selectedTeam, selectedUser, dueDateFrom, dueDateTo, activeBoardId, viewMode, router])

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users')
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch('/api/boards')
      if (res.ok) {
        const data = await res.json()
        setBoards(data.boards || [])
      }
    } catch (e) {
      console.error('Error fetching boards:', e)
    }
  }, [])

  useEffect(() => {
    if (session?.user) {
      fetchUsers()
      fetchBoards()
    }
  }, [session, fetchBoards])

  // Track recently-opened boards (per browser) for the switcher's quick tabs.
  useEffect(() => {
    if (!activeBoardId) return
    setRecentBoardIds(prev => {
      const next = [activeBoardId, ...prev.filter(id => id !== activeBoardId)].slice(0, 8)
      try { localStorage.setItem('tms:recentBoards', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [activeBoardId])

  const selectBoard = (id: string | null) => { setActiveBoardId(id); setShowBoardSwitcher(false); setBoardSearch('') }
  const toggleBoardStar = async (board: KanbanBoard) => {
    try {
      const res = await fetch(`/api/boards/${board.id}/star`, { method: board.isStarred ? 'DELETE' : 'POST' })
      if (res.ok) fetchBoards()
    } catch { /* ignore */ }
  }
  // Per-user category: a free-text label this user assigns to a board to group
  // their own switcher. Personal to the caller; doesn't affect other users.
  // Close a board's quick tab: drop it from recents, and if it's starred,
  // unstar it so it leaves the strip. The board stays available in the switcher.
  const closeBoardTab = (board: KanbanBoard) => {
    setRecentBoardIds(prev => {
      const next = prev.filter(id => id !== board.id)
      try { localStorage.setItem('tms:recentBoards', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
    if (board.isStarred) void toggleBoardStar(board)
    if (activeBoardId === board.id) selectBoard(null)
  }
  const setBoardCategory = async (board: KanbanBoard, value: string) => {
    const v = value.trim()
    setCategoryEditId(null)
    if ((v || null) === (board.category ?? null)) return
    try {
      const res = await fetch(`/api/boards/${board.id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: v || null }),
      })
      if (res.ok) fetchBoards()
    } catch { /* ignore */ }
  }

  const createBoard = async () => {
    if (!newBoardName.trim()) return
    setCreatingBoard(true)
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBoardName.trim(),
          description: newBoardDescription || undefined,
          color: newBoardColor,
          memberIds: newBoardMemberIds,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setBoards(prev => [...prev, data.board])
        setActiveBoardId(data.board.id)
        setShowCreateBoard(false)
        setNewBoardName('')
        setNewBoardDescription('')
        setNewBoardColor('#3B82F6')
        setNewBoardMemberIds([])
        toast({ title: `Board "${data.board.name}" created` })
      }
    } catch (e) {
      console.error('Error creating board:', e)
    } finally {
      setCreatingBoard(false)
    }
  }

  const deleteBoard = async (boardId: string): Promise<boolean> => {
    const board = boards.find(b => b.id === boardId)
    if (!board) return false
    try {
      const res = await fetch(`/api/boards/${boardId}`, { method: 'DELETE' })
      if (res.ok) {
        setBoards(prev => prev.filter(b => b.id !== boardId))
        if (activeBoardId === boardId) setActiveBoardId(null)
        toast({ title: `Board "${board.name}" deleted. Tasks moved to All Tasks.` })
        fetchTasks(false)
        return true
      }
      const err = await res.json().catch(() => ({}))
      toast({ title: 'Could not delete board', description: err.error, variant: 'destructive' })
      return false
    } catch (e) {
      console.error('Error deleting board:', e)
      toast({ title: 'Could not delete board', variant: 'destructive' })
      return false
    }
  }

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return

    const { draggableId, destination, source } = result

    // The droppable id is a BoardStatus id (board view) or a category (All Tasks).
    const destCol = boardColumns.find((c) => c.key === destination.droppableId)
    const newStatus = (destCol?.category ?? destination.droppableId) as Task['status']
    // Only set customStatusId when dropping into a real board-status column.
    const destCustomStatusId =
      destCol && !CATEGORY_KEYS.includes(destCol.key as any) ? destCol.key : undefined

    // Don't do anything if dropped in the same position
    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return
    }

    // Find the task being moved
    const taskBeingMoved = tasks.find(t => t.id === draggableId)
    if (!taskBeingMoved) return

    // Check if user can change task status
    if (!canUserChangeTaskStatus(taskBeingMoved)) {
      toast({
        title: 'Cannot Move Task',
        description: 'You cannot change the status of this task. Please add comments to communicate with the task owner instead.',
        variant: 'destructive'
      })
      return
    }

    // Only the assigner/creator/admin can move to COMPLETED
    if (newStatus === 'COMPLETED' && !canUserCompleteTask(taskBeingMoved)) {
      toast({
        title: 'Cannot Complete Task',
        description: 'Only the person who assigned this task can mark it as completed. Please move it to "In Review" instead.',
        variant: 'destructive'
      })
      return
    }

    // Reflect the new column in the task's progress so an In Progress / In Review
    // card doesn't sit at 0%. Only bumps the value up — never lowers a higher one.
    const STATUS_PROGRESS_FLOOR: Record<string, number> = {
      TODO: 0, IN_PROGRESS: 10, IN_REVIEW: 90, COMPLETED: 100,
    }
    const floor = STATUS_PROGRESS_FLOOR[newStatus] ?? 0
    const newProgress = Math.max(taskBeingMoved.progressPercentage || 0, floor)

    // Optimistically update the UI
    setTasks(prev =>
      prev.map(task =>
        task.id === draggableId
          ? { ...task, status: newStatus, progressPercentage: newProgress, ...(destCustomStatusId ? { customStatusId: destCustomStatusId } : {}) }
          : task
      )
    )

    try {
      const response = await fetch(`/api/tasks/${draggableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, progressPercentage: newProgress, ...(destCustomStatusId ? { customStatusId: destCustomStatusId } : {}) })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to update task status`)
      }

      // Get the updated task data from the response
      const responseData = await response.json()
      const { updatedParentTask, ...updatedTask } = responseData

      // Update the task with the server response to ensure consistency
      // Also update parent task if a subtask was moved
      setTasks(prev =>
        prev.map(task => {
          if (task.id === draggableId) return updatedTask
          if (updatedParentTask && task.id === updatedParentTask.id) return updatedParentTask
          return task
        })
      )

      toast({
        title: 'Success',
        description: `Task moved to ${COLUMN_CONFIG[newStatus].title}`,
      })

    } catch (err) {
      console.error('Error updating task status:', err)

      // Revert on error
      setTasks(prev =>
        prev.map(task =>
          task.id === draggableId
            ? { ...task, status: taskBeingMoved.status, progressPercentage: taskBeingMoved.progressPercentage, customStatusId: taskBeingMoved.customStatusId }
            : task
        )
      )

      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update task status',
        variant: 'destructive'
      })
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'bg-red-500'
      case 'HIGH': return 'bg-orange-500'
      case 'MEDIUM': return 'bg-yellow-500'
      case 'LOW': return 'bg-green-500'
      default: return 'bg-gray-500'
    }
  }

  const getTaskTypeIcon = (taskType: string) => {
    switch (taskType) {
      case 'INDIVIDUAL': return <User className="h-3 w-3" />
      case 'TEAM': return <Users className="h-3 w-3" />
      case 'COLLABORATION': return <Handshake className="h-3 w-3" />
      case 'CASCADING': return <GitBranch className="h-3 w-3" />
      default: return <User className="h-3 w-3" />
    }
  }

  const getProgressColor = (percentage: number) => {
    if (percentage < 25) return 'bg-red-500'
    if (percentage < 50) return 'bg-orange-500'
    if (percentage < 75) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getTasksByStatus = (status: Task['status']) => {
    const query = searchTerm.toLowerCase().trim()
    return tasks.filter(task => {
      // Filter by status
      if (task.status !== status) return false

      // Filter by search term (local filtering)
      if (query) {
        const titleMatch = task.title.toLowerCase().includes(query)
        const descMatch = task.description?.toLowerCase().includes(query)
        const assigneeMatch =
          task.assignee?.name?.toLowerCase().includes(query) ||
          task.assignee?.email?.toLowerCase().includes(query) ||
          task.assignees?.some(a =>
            a.user?.name?.toLowerCase().includes(query) || a.user?.email?.toLowerCase().includes(query))
        return titleMatch || descMatch || assigneeMatch
      }

      return true
    })
  }

  // Distinct badge styling per task type so Cascading/Team/Collaboration read at a glance.
  const getTaskTypeBadgeClass = (taskType: string): string => {
    switch (taskType) {
      case 'CASCADING': return 'bg-indigo-50 text-indigo-700 border-indigo-200'
      case 'TEAM': return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'COLLABORATION': return 'bg-teal-50 text-teal-700 border-teal-200'
      default: return 'bg-slate-50 text-slate-600 border-slate-200'
    }
  }

  const getTaskTypeLabel = (taskType: string): string =>
    taskType.charAt(0) + taskType.slice(1).toLowerCase()

  // Unified "Assigned To" list — the union of the (dual-written) legacy assignee
  // + team members + collaborators, de-duped. The flat list users now manage.
  const getTaskAssignees = (t: Task): Array<{ id: string; name?: string; email: string; image?: string }> => {
    const map = new Map<string, any>()
    if (t.assignee) map.set(t.assignee.id, t.assignee)
    t.teamMembers?.forEach((m: any) => { if (m.user) map.set(m.user.id, m.user) })
    t.collaborators?.forEach((c: any) => { if (c.user) map.set(c.user.id, c.user) })
    return Array.from(map.values())
  }

  const getRecurrenceLabel = (recurrence?: string): string => {
    if (!recurrence) return 'Repeats'
    const upper = recurrence.toUpperCase()
    if (upper.includes('FREQ=DAILY')) return 'Daily'
    if (upper.includes('FREQ=WEEKLY')) return 'Weekly'
    if (upper.includes('FREQ=MONTHLY')) return 'Monthly'
    return 'Repeats'
  }

  const handleCreateTask = async (taskData: any) => {
    try {
      // Extract subtasks from data
      const { subtasks, ...mainTaskData } = taskData
      // Inject active board id
      if (activeBoardId) {
        mainTaskData.boardId = activeBoardId
      }

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mainTaskData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Create task error response:', errorData)
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to create task`)
      }

      const newTask = await response.json()

      // Recurring tasks return { template, firstInstance }; regular tasks return the task directly
      const parentTaskId = newTask.id ?? newTask.firstInstance?.id

      // Create subtasks if any
      if (subtasks && subtasks.length > 0 && parentTaskId) {
        const subtaskPromises = subtasks.map((subtask: { title: string; assigneeId: string }) =>
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
        await Promise.all(subtaskPromises)
      }

      // Refresh tasks from server to ensure we get the latest data
      await fetchTasks()

      // Refresh board counts
      fetchBoards()

      const subtaskCount = subtasks?.length || 0
      toast({
        title: 'Success',
        description: subtaskCount > 0
          ? `Task created with ${subtaskCount} subtask${subtaskCount !== 1 ? 's' : ''}`
          : 'Task created successfully'
      })
    } catch (error) {
      console.error('Error creating task:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create task',
        variant: 'destructive'
      })
    }
  }

  // Archive a task to the Backlog (hidden from the board). Restore brings it
  // back to To Do. Clearing customStatusId detaches it from any column.
  const moveTaskToBacklog = async (task: Task) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'BACKLOG', progressPercentage: 0, customStatusId: null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to move task')
      await fetchTasks(false); fetchBoards()
      toast({ title: 'Moved to Backlog', description: 'Archived. Restore it anytime from the Backlog panel.' })
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Could not move to Backlog', variant: 'destructive' })
    }
  }

  const restoreFromBacklog = async (task: Task) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'TODO', progressPercentage: 0, customStatusId: null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to restore task')
      await fetchTasks(false); fetchBoards()
      toast({ title: 'Restored to To Do' })
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Could not restore task', variant: 'destructive' })
    }
  }

  const handleUpdateTask = async (taskData: any) => {
    if (!editingTask) return

    try {
      const response = await fetch(`/api/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Update task error response:', errorData)
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to update task`)
      }

      await response.json()

      // Refresh tasks to ensure we have the latest data
      await fetchTasks()

      setEditingTask(null)
      toast({
        title: 'Success',
        description: 'Task updated successfully'
      })
    } catch (error) {
      console.error('Error updating task:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update task',
        variant: 'destructive'
      })
    }
  }

  const handleDeleteTask = async () => {
    if (!deletingTask) return

    try {
      const url = deleteScope === 'series' && deletingTask.recurringParentId
        ? `/api/tasks/${deletingTask.id}?scope=series`
        : `/api/tasks/${deletingTask.id}`

      const response = await fetch(url, { method: 'DELETE' })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Delete task error response:', errorData)
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to delete task`)
      }


      // Refresh tasks to ensure we have the latest data
      await fetchTasks()
      fetchBoards()

      setDeletingTask(null)
      setDeleteScope('single')
      toast({
        title: 'Success',
        description: deleteScope === 'series' ? 'Recurring series deleted' : 'Task deleted successfully'
      })
    } catch (error) {
      console.error('Error deleting task:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete task',
        variant: 'destructive'
      })
    }
  }

  // Toggle a subtask between TODO and COMPLETED inline from the parent card
  const handleToggleSubtask = async (e: React.MouseEvent, subtaskId: string, currentStatus: string) => {
    e.stopPropagation()
    const newStatus = currentStatus === 'COMPLETED' ? 'TODO' : 'COMPLETED'
    try {
      await fetch(`/api/tasks/${subtaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, progressPercentage: newStatus === 'COMPLETED' ? 100 : 0 }),
      })
      await fetchTasks(false)
    } catch {
      // silent — next refresh will correct the state
    }
  }

  // Helper function to check if task was created by current user
  const isTaskCreatedByUser = (task: Task) => {
    return task.creator?.id === session?.user?.id
  }

  // Helper function to check if user can delete the task
  const canDeleteTask = (task: Task) => {
    // Can delete if user created the task
    if (task.creator?.id === session?.user?.id) {
      return true
    }
    // Can delete if user is a leader and assigned the task
    if (session?.user?.role === 'LEADER' && task.assignedBy?.id === session?.user?.id) {
      return true
    }
    // Admin can delete any task
    if (session?.user?.role === 'ADMIN') {
      return true
    }
    return false
  }

  // Helper function to check if task is new (created within last 3 days)
  const isTaskNew = (task: Task) => {
    const threeDaysAgo = subDays(new Date(), 3)
    return isAfter(new Date(task.createdAt), threeDaysAgo)
  }

  // Helper function to check if user can edit the task
  const canUserEditTask = (task: Task) => {
    if (task.viewerCanComplete !== undefined) {
      if (task.viewerCanComplete) return true
    } else {
      if (session?.user?.role === 'ADMIN') return true
      if (task.creator?.id === session?.user?.id) return true
      if (task.board?.ownerId === session?.user?.id) return true
      if (session?.user?.role === 'LEADER') return true
    }
    const isAssignee = task.assignee?.id === session?.user?.id || task.assignees?.some(a => a.userId === session?.user?.id)
    if (isAssignee) return true
    return false
  }

  // Helper function to check if user can change task status (move to IN_PROGRESS or IN_REVIEW)
  const canUserChangeTaskStatus = (task: Task) => {
    if (task.viewerCanChangeStatus !== undefined) {
      return task.viewerCanChangeStatus
    }

    // Task creator can always change status
    if (task.creator?.id === session?.user?.id) return true

    // Admin can change any task status
    if (session?.user?.role === 'ADMIN') return true

    // Board owner can always change status
    if (task.board?.ownerId === session?.user?.id) return true

    // Leaders can change status for tasks in their teams
    if (session?.user?.role === 'LEADER') return true

    // Assignee can move to IN_PROGRESS and IN_REVIEW (not COMPLETED - checked separately)
    if (task.assignee?.id === session?.user?.id) {
      const isTeamMember = task.teamMembers?.some(tm => tm.userId === session?.user?.id)
      const isCollaborator = task.collaborators?.some(c => c.userId === session?.user?.id)
      return !isTeamMember && !isCollaborator
    }

    return false
  }

  // Helper function to check if user can mark task as COMPLETED
  // Only the assigner (assignedBy), creator, or admin can complete a task
  const canUserCompleteTask = (task: Task) => {
    if (task.viewerCanComplete !== undefined) {
      return task.viewerCanComplete
    }

    if (session?.user?.role === 'ADMIN') return true
    if (task.creator?.id === session?.user?.id) return true
    if (task.board?.ownerId === session?.user?.id) return true
    if (task.assignedBy?.id === session?.user?.id) return true
    if (session?.user?.role === 'LEADER') return true
    return false
  }

  // Helper function to open view modal for all users
  const handleTaskClick = (task: Task) => {
    setViewingTask(task)
    setShowViewModal(true)
  }

  // Navigate to a subtask's detail by fetching and swapping the modal content
  const handleSubtaskClick = async (subtaskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${subtaskId}`)
      if (response.ok) {
        const subtask = await response.json()
        // Push current task onto history before navigating into subtask
        if (viewingTask) {
          setTaskHistory(prev => [...prev, viewingTask])
        }
        setViewingTask(subtask)
      }
    } catch (err) {
      console.error('Error fetching subtask:', err)
    }
  }

  // Go back to the previous task in the navigation history
  const handleGoBack = () => {
    setTaskHistory(prev => {
      const history = [...prev]
      const parent = history.pop()
      if (parent) setViewingTask(parent)
      return history
    })
  }

  // Helper function to open edit modal (called from view modal)
  const handleEditFromView = (task: Task) => {
    setEditingTask(task)
    setShowTaskForm(true)
    setShowViewModal(false)
  }

  const openEditForm = (task: Task) => {
    setEditingTask(task)
    setShowTaskForm(true)
  }

  const openDuplicateForm = (task: Task) => {
    setPendingDuplicateTask(task)
    setShowDuplicateDialog(true)
  }

  const handleDuplicateConfirm = (filteredTask: any) => {
    setDuplicatingTask(filteredTask)
    setEditingTask(null)
    setShowTaskForm(true)
    setShowDuplicateDialog(false)
    setPendingDuplicateTask(null)
  }

  const closeTaskForm = () => {
    setShowTaskForm(false)
    setEditingTask(null)
    setDuplicatingTask(null)
    setQuickAddStatus(undefined)
    setQuickAddCustomStatusId(undefined)
  }

  const closeViewModal = () => {
    setShowViewModal(false)
    setViewingTask(null)
    setTaskHistory([])
    // Refresh tasks in background to reflect any changes made in the modal
    fetchTasks(false)
  }

  const activeBoard = activeBoardId ? boards.find(b => b.id === activeBoardId) : undefined
  const filterUserOptions = activeBoard
    ? activeBoard.team?.members
      ? activeBoard.team.members.map(m => ({ id: m.user.id, name: m.user.name || m.user.email, email: m.user.email, image: m.user.image }))
      : activeBoard.members.map(m => ({ id: m.user.id, name: m.user.name || m.user.email, email: m.user.email, image: m.user.image }))
    : users.map(u => ({ id: u.id, name: u.name || u.email, email: u.email, image: u.image }))
  // NOTE: all hooks MUST stay above the early returns below — otherwise the hook
  // count changes between the loading and loaded renders (React error #310).
  useEffect(() => {
    // Re-validate on activeBoard change AND when boards/users finish loading
    // async — otherwise a bookmarked ?board=X&user=Y (Y not a member of X) keeps
    // the stale selection because the options narrow only after boards arrive.
    if (selectedUser && !filterUserOptions.some(u => u.id === selectedUser)) {
      setSelectedUser('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId, boards, users])
  const boardContext = activeBoard
    ? { boardId: activeBoard.id, boardName: activeBoard.name, teamId: activeBoard.team?.id ?? null }
    : null

  // Kanban columns for the current view. A selected board renders its custom
  // statuses; "All Tasks" (or a board with no statuses) falls back to the four
  // category defaults — so an un-customized board looks identical to before.
  const boardColumns: KanbanColumn[] = (() => {
    const statuses = activeBoard?.statuses
    if (!activeBoard || !statuses || statuses.length === 0) return DEFAULT_COLUMNS
    return [...statuses]
      // BACKLOG is a hidden archive, CANCELLED is never shown — neither is a column.
      .filter((s) => s.category !== 'CANCELLED' && s.category !== 'BACKLOG')
      .sort((a, b) => a.position - b.position)
      .map((s) => {
        const cfg = COLUMN_CONFIG[s.category as keyof typeof COLUMN_CONFIG]
        return {
          key: s.id,
          title: s.name,
          category: s.category as KanbanColumn['category'],
          isDefault: s.isDefault,
          color: s.color,
          headerClass: s.isDefault && cfg ? cfg.color : 'bg-muted',
          textClass: s.isDefault && cfg ? cfg.textColor : 'text-foreground',
        }
      })
  })()

  // Bucket tasks into a column. Board-status columns match by customStatusId,
  // falling back to the default column for the task's category when unset (so a
  // task never disappears). "All Tasks" category columns match by status.
  const getTasksForColumn = (col: KanbanColumn) => {
    const query = searchTerm.toLowerCase().trim()
    const byStatusId = !CATEGORY_KEYS.includes(col.key as any)
    return tasks.filter((task) => {
      const inCol = byStatusId
        ? task.customStatusId === col.key ||
          (task.customStatusId == null && col.isDefault && task.status === col.category)
        : task.status === col.category
      if (!inCol) return false
      if (query) {
        const titleMatch = task.title.toLowerCase().includes(query)
        const descMatch = task.description?.toLowerCase().includes(query)
        const assigneeMatch =
          task.assignee?.name?.toLowerCase().includes(query) ||
          task.assignee?.email?.toLowerCase().includes(query) ||
          task.assignees?.some(a =>
            a.user?.name?.toLowerCase().includes(query) || a.user?.email?.toLowerCase().includes(query))
        return titleMatch || descMatch || assigneeMatch
      }
      return true
    })
  }

  // Timeline drag-to-reschedule: optimistic dates, PATCH, rollback + toast on error.
  const handleReschedule = useCallback(async (taskId: string, dates: { startDate: string; dueDate: string }) => {
    const prev = tasks
    setTasks(cur => cur.map(t => (t.id === taskId ? { ...t, startDate: dates.startDate, dueDate: dates.dueDate } : t)))
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dates),
      })
      if (!res.ok) throw new Error('reschedule failed')
    } catch {
      setTasks(prev)
      toast({ title: 'Could not reschedule', description: 'The task dates were not saved. Please try again.', variant: 'destructive' })
    }
  }, [tasks, toast])

  // Only block the page on the very first load. After that, refetches happen
  // in the background so an open TaskForm / TaskViewModal stays mounted and
  // keeps its in-progress data when the user alt-tabs back.
  if (loading && !hasLoadedOnce) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error && !hasLoadedOnce) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  // ── Board switcher data ──
  const starredBoards = boards.filter(b => b.isStarred)
  const recentBoards = recentBoardIds
    .map(id => boards.find(b => b.id === id))
    .filter((b): b is KanbanBoard => !!b)
  let quickTabs = [...starredBoards, ...recentBoards.filter(b => !b.isStarred)]
  if (activeBoardId && !quickTabs.some(b => b.id === activeBoardId)) {
    const ab = boards.find(b => b.id === activeBoardId)
    if (ab) quickTabs = [ab, ...quickTabs]
  }
  quickTabs = quickTabs.slice(0, 6)

  const boardQuery = boardSearch.trim().toLowerCase()
  const searchedBoards = boardQuery ? boards.filter(b => b.name.toLowerCase().includes(boardQuery)) : boards
  const swStarred = searchedBoards.filter(b => b.isStarred)
  const swRecent = recentBoards.filter(b => !b.isStarred && searchedBoards.includes(b))
  // Group the rest by the user's own category. If a board has no category, fall
  // back to its team name (team boards) or "Personal" (own boards).
  const swGroups: Record<string, KanbanBoard[]> = {}
  searchedBoards.filter(b => !b.isStarred && !swRecent.includes(b)).forEach(b => {
    const key = b.category?.trim() || (b.team ? b.team.name : 'Personal')
    ;(swGroups[key] ||= []).push(b)
  })
  // Stable order: categories alphabetical, with the catch-all "Personal" last.
  const swGroupKeys = Object.keys(swGroups).sort((a, b) =>
    a === 'Personal' ? 1 : b === 'Personal' ? -1 : a.localeCompare(b))
  // The user's existing categories, for the inline editor's autocomplete.
  const allCategories = Array.from(
    new Set(boards.map(b => b.category?.trim()).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b))

  const renderBoardRow = (board: KanbanBoard) => {
    const isOwner = board.ownerId === session?.user?.id
    return (
      <div key={board.id} className={cn('group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50', activeBoardId === board.id && 'bg-blue-50')}>
        <button onClick={(e) => { e.stopPropagation(); toggleBoardStar(board) }} title={board.isStarred ? 'Unstar' : 'Star'} className="shrink-0 text-gray-300 hover:text-amber-400 transition-colors">
          <Star className={cn('h-4 w-4', board.isStarred && 'fill-amber-400 text-amber-400')} />
        </button>
        <button onClick={() => selectBoard(board.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: board.color }} />
          <span className="truncate text-sm text-gray-800">{board.name}</span>
          <span className="text-xs text-gray-400 shrink-0">({board._count.tasks})</span>
          {board.team && <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full leading-none shrink-0">team</span>}
        </button>
        {categoryEditId === board.id ? (
          <input
            autoFocus
            list="board-category-list"
            defaultValue={board.category ?? ''}
            placeholder="Category…"
            maxLength={60}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => setBoardCategory(board, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setBoardCategory(board, e.currentTarget.value)
              else if (e.key === 'Escape') setCategoryEditId(null)
            }}
            className="shrink-0 w-24 h-6 text-xs px-1.5 rounded border border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setCategoryEditId(board.id) }}
            title={board.category ? `Category: ${board.category}` : 'Set category'}
            className={cn(
              'shrink-0 flex items-center gap-1 text-[11px] transition-colors',
              board.category ? 'text-gray-600 hover:text-blue-600' : 'text-gray-300 hover:text-blue-600',
            )}
          >
            {board.category
              ? <span className="max-w-[7rem] truncate px-1.5 py-0.5 bg-gray-100 rounded">{board.category}</span>
              : <Tag className="h-3.5 w-3.5" />}
          </button>
        )}
        {board.team ? (
          <Link href={`/user/teams/${board.team.id}`} onClick={() => setShowBoardSwitcher(false)} className="shrink-0 text-gray-300 hover:text-gray-600" title="Manage team">
            <Settings2 className="h-3.5 w-3.5" />
          </Link>
        ) : isOwner ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 text-gray-300 hover:text-gray-600" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-3.5 w-3.5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => { setEditingBoard(board); setEditingBoardMemberIds(board.members.map(m => m.userId)); setShowBoardSwitcher(false) }}>
                <Settings2 className="h-4 w-4 mr-2" /> Edit Board
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-600" onClick={() => { setBoardPendingDelete(board); setShowBoardSwitcher(false) }}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    )
  }
  const renderBoardGroup = (label: string, list: KanbanBoard[]) => list.length === 0 ? null : (
    <div key={label} className="mb-1">
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      {list.map(renderBoardRow)}
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Tasks</h1>
          <p className="text-muted-foreground">
            Manage your tasks and collaborations
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setShowBacklog(true)} title="View archived (backlog) tasks">
            <Archive className="h-4 w-4 mr-2" />
            Backlog{tasks.filter(t => t.status === 'BACKLOG').length > 0 ? ` (${tasks.filter(t => t.status === 'BACKLOG').length})` : ''}
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleExport} disabled={exporting} title="Export to Excel">
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setBulkDialogOpen(true)}>
            <ListChecks className="h-4 w-4 mr-2" />
            Bulk
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={() => setShowTaskForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      {/* Board Switcher — searchable dropdown (left) + quick tabs (starred/recent) */}
      <div className="flex items-stretch gap-1 border-b border-gray-200">
        {/* Switch board — searchable dropdown; scales to any number of boards */}
        <div className="relative shrink-0 self-center pb-1">
          <button
            onClick={() => setShowBoardSwitcher(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap"
          >
            <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="max-w-[180px] truncate">
              {activeBoardId ? (boards.find(b => b.id === activeBoardId)?.name ?? 'Board') : 'All Tasks'}
            </span>
            <span className="text-xs text-gray-400">({boards.length})</span>
          </button>
          {showBoardSwitcher && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowBoardSwitcher(false)} />
              <div className="absolute left-0 mt-1 z-30 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl p-2">
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    autoFocus
                    value={boardSearch}
                    onChange={(e) => setBoardSearch(e.target.value)}
                    placeholder="Search boards…"
                    className="w-full pl-8 pr-2 h-8 rounded-md border border-gray-200 text-sm focus:outline-none focus:border-blue-300"
                  />
                </div>
                {/* All Tasks (cross-board view) */}
                <button
                  onClick={() => selectBoard(null)}
                  className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm mb-1', activeBoardId === null ? 'bg-blue-50 text-blue-700' : 'text-gray-800 hover:bg-gray-50')}
                >
                  <ListTodo className="h-4 w-4 text-gray-500" />
                  <span className="flex-1 text-left">All Tasks</span>
                </button>
                <datalist id="board-category-list">
                  {allCategories.map(c => <option key={c} value={c} />)}
                </datalist>
                {renderBoardGroup('Starred', swStarred)}
                {renderBoardGroup('Recent', swRecent)}
                {swGroupKeys.map(name => renderBoardGroup(name, swGroups[name]))}
                {searchedBoards.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-gray-400">No boards match “{boardSearch}”.</p>
                )}
                <button
                  onClick={() => { setShowCreateBoard(true); setShowBoardSwitcher(false) }}
                  className="mt-1 w-full flex items-center gap-2 px-2 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
                >
                  <Plus className="h-4 w-4" /> New personal board
                </button>
              </div>
            </>
          )}
        </div>

        {/* Quick tabs: starred + recently-opened boards (capped) */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 flex-1 min-w-0">
          {quickTabs.map(board => (
            <button
              key={board.id}
              onClick={() => selectBoard(board.id)}
              className={cn(
                'group shrink-0 flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                activeBoardId === board.id
                  ? 'text-gray-900 bg-gray-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              )}
              style={activeBoardId === board.id ? { borderBottomColor: board.color } : {}}
              title={board.name}
            >
              {board.isStarred && <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />}
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: board.color }} />
              <span className="max-w-[160px] truncate">{board.name}</span>
              <span className="text-xs text-gray-400 font-normal">({board._count.tasks})</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${board.name} tab`}
                title="Close tab"
                onClick={(e) => { e.stopPropagation(); closeBoardTab(board) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); closeBoardTab(board) } }}
                className="shrink-0 ml-0.5 flex items-center justify-center h-4 w-4 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-700 transition-opacity"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 sm:gap-4 items-center">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks by title, description, or users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        <SearchableSelect
          options={filterUserOptions}
          value={selectedUser}
          onValueChange={setSelectedUser}
          placeholder="Filter by user"
          allLabel="All users"
          maxDisplayed={10}
          className="w-full sm:w-[200px]"
        />

        <DueDateRangeFilter
          from={dueDateFrom}
          to={dueDateTo}
          onChange={(f, t) => { setDueDateFrom(f); setDueDateTo(t) }}
        />

        {(selectedUser || searchTerm || dueDateFrom || dueDateTo) && (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => {
              setSelectedUser('')
              setSearchTerm('')
              setDueDateFrom('')
              setDueDateTo('')
            }}
          >
            Clear Filters
          </Button>
        )}

        {/* Customize statuses — board owner / leader / admin, board view only */}
        {activeBoard?.canManage && viewMode === 'board' && (
          <Button variant="outline" size="sm" className="h-8 sm:ml-auto" onClick={() => setBoardSettingsOpen(true)} title="Customize statuses">
            <Settings2 className="h-4 w-4 mr-1.5" /> Customize
          </Button>
        )}

        {/* Board / Timeline toggle — right side of the filters row */}
        <div className={`inline-flex items-center gap-1 rounded-md border border-slate-200 p-0.5 ${activeBoard?.canManage && viewMode === 'board' ? '' : 'sm:ml-auto'}`}>
          {(['board', 'timeline'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-3 h-7 rounded text-xs font-semibold capitalize ${
                viewMode === m ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      {viewMode === 'board' && (
      <DragDropContext onDragEnd={handleDragEnd}>
        {/* ≤4 statuses: a responsive grid that fills the width. >4 (custom
            statuses): a horizontally-scrolling row of fixed-width columns so
            they never wrap to a second row. */}
        <div className={
          boardColumns.length > 4
            ? 'flex gap-4 md:gap-6 min-h-[700px] overflow-x-auto thin-scrollbar pb-3 -mx-1 px-1'
            : `grid grid-cols-1 md:grid-cols-2 ${
                boardColumns.length >= 4 ? 'lg:grid-cols-4'
                : boardColumns.length === 3 ? 'lg:grid-cols-3'
                : boardColumns.length === 2 ? 'lg:grid-cols-2'
                : 'lg:grid-cols-1'
              } gap-3 md:gap-6 min-h-[700px]`
        }>
          {boardColumns.map((col) => {
            const columnTasks = getTasksForColumn(col)

            return (
              <div key={col.key} className={boardColumns.length > 4 ? 'w-[280px] sm:w-[300px] shrink-0 space-y-4' : 'min-w-0 space-y-4'}>
                <div className={`p-3 rounded-lg ${col.headerClass} shadow-sm`}>
                  <h3 className={`font-semibold ${col.textClass} flex items-center text-sm`}>
                    {!col.isDefault && col.color && (
                      <span className="mr-1.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                    )}
                    <span>{col.title}</span>
                    <Badge variant="secondary" className="ml-2 text-xs">{columnTasks.length}</Badge>
                    <button
                      type="button"
                      title={`Add task to ${col.title}`}
                      onClick={() => { setQuickAddStatus(col.category); setQuickAddCustomStatusId(CATEGORY_KEYS.includes(col.key as any) ? undefined : col.key); setShowTaskForm(true) }}
                      className="ml-auto p-1 rounded hover:bg-black/10 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </h3>
                </div>

                <Droppable droppableId={col.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`space-y-3 h-[620px] overflow-y-auto overflow-x-hidden thin-scrollbar p-2 rounded-lg transition-colors ${
                        snapshot.isDraggingOver ? 'bg-muted/20 border-2 border-dashed border-primary/30' : ''
                      }`}
                    >
                      {columnTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={!canUserChangeTaskStatus(task)}>
                          {(provided, snapshot) => {
                            const canDrag = canUserChangeTaskStatus(task)
                            return (
                            <Card
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...(canDrag ? provided.dragHandleProps : {})}
                              className={`relative cursor-pointer transition-all duration-200 min-h-[160px] ${
                                canDrag
                                  ? 'hover:cursor-grab active:cursor-grabbing'
                                  : 'cursor-default'
                              } ${
                                snapshot.isDragging
                                  ? 'shadow-xl rotate-2 scale-105 z-50'
                                  : canDrag ? 'hover:shadow-md hover:-translate-y-1 shadow-sm' : 'shadow-sm'
                              } bg-white border border-gray-200 rounded-lg ${
                                !canDrag ? 'opacity-90' : ''
                              }`}
                              onClick={(e) => {
                                // Only open edit if not dragging and clicked on card content
                                if (!snapshot.isDragging) {
                                  handleTaskClick(task)
                                }
                              }}
                            >
                              <CardContent className="p-3.5">
                                {/* New Task Indicator */}
                                {isTaskNew(task) && !isTaskCreatedByUser(task) && (
                                  <div className="absolute -top-2 -right-2 z-10">
                                    <div className="bg-red-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg animate-pulse">
                                      NEW
                                    </div>
                                  </div>
                                )}

                                {/* Cannot Move Indicator */}
                                {!canUserChangeTaskStatus(task) && (
                                  <div className="absolute -top-2 -left-2 z-10">
                                    <div className="bg-amber-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
                                      💬 Comment Only
                                    </div>
                                  </div>
                                )}

                                {/* Header: title + actions */}
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <h4 className="font-semibold text-sm leading-snug text-gray-900 line-clamp-2 flex-1 min-w-0">
                                    {task.title}
                                  </h4>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 flex-shrink-0 -mr-1 -mt-0.5"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {/* View option - available for all users */}
                                      <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        handleTaskClick(task)
                                      }}>
                                        <Eye className="h-4 w-4 mr-2" />
                                        View Details
                                      </DropdownMenuItem>

                                      {/* Edit option - for users who can edit */}
                                      {canUserEditTask(task) && (
                                        <DropdownMenuItem onClick={(e) => {
                                          e.stopPropagation()
                                          openEditForm(task)
                                        }}>
                                          <Edit className="h-4 w-4 mr-2" />
                                          Edit
                                        </DropdownMenuItem>
                                      )}

                                      {/* Duplicate option - available to all */}
                                      <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        openDuplicateForm(task)
                                      }}>
                                        <Copy className="h-4 w-4 mr-2" />
                                        Duplicate
                                      </DropdownMenuItem>

                                      {/* Move to another team / personal board */}
                                      {canUserEditTask(task) && (
                                        <DropdownMenuItem onClick={(e) => {
                                          e.stopPropagation()
                                          setMovingTask(task)
                                        }}>
                                          <FolderInput className="h-4 w-4 mr-2" />
                                          Move to board…
                                        </DropdownMenuItem>
                                      )}

                                      {/* Move to Backlog (archive) — hides it from the board until restored */}
                                      {canUserChangeTaskStatus(task) && task.status !== 'BACKLOG' && (
                                        <DropdownMenuItem onClick={(e) => {
                                          e.stopPropagation()
                                          moveTaskToBacklog(task)
                                        }}>
                                          <Archive className="h-4 w-4 mr-2" />
                                          Move to Backlog
                                        </DropdownMenuItem>
                                      )}

                                      {/* Delete option - shown if user can delete */}
                                      {canDeleteTask(task) && (
                                        <DropdownMenuItem
                                          className="text-red-600"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setDeletingTask(task)
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>

                                {/* Meta badges: recurring, cascading, relationship, team */}
                                <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                                  {(task.recurrence || task.recurringParentId) && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 h-5 gap-1 font-medium bg-blue-50 text-blue-700 border-blue-200">
                                      <RefreshCw className="h-3 w-3" />
                                      {getRecurrenceLabel(task.recurrence)}
                                    </Badge>
                                  )}
                                  {task.parentId && (
                                    <Badge className="text-[10px] px-1.5 h-5 bg-violet-500 text-white border-violet-600">
                                      Subtask
                                    </Badge>
                                  )}
                                  {!isTaskCreatedByUser(task) && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                                      Assigned
                                    </Badge>
                                  )}
                                  {task.team && (
                                    <Badge
                                      variant="secondary"
                                      title={task.team.name}
                                      className="text-[10px] px-1.5 h-5 gap-1 inline-flex items-center max-w-[160px]"
                                    >
                                      <Users className="h-3 w-3 shrink-0 opacity-70" />
                                      <span className="truncate">{task.team.name}</span>
                                    </Badge>
                                  )}
                                </div>

                                {/* Description */}
                                {task.description && (
                                  <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed mb-2.5">
                                    {task.description}
                                  </p>
                                )}

                                {/* Progress: inline bar + %, label dropped (redundant on a card) */}
                                <div className="flex items-center gap-2 mb-2.5">
                                  <Progress
                                    value={task.progressPercentage || 0}
                                    className="h-1.5 bg-gray-200 flex-1"
                                  />
                                  <span className="text-[11px] font-semibold text-gray-600 tabular-nums shrink-0">
                                    {task.progressPercentage || 0}%
                                  </span>
                                </div>

                                {/* Meta footer: priority, due date, subtasks, comments, weight, SLA, meeting */}
                                {(() => {
                                  // Weekly schedule-health, so the red date text agrees with the badge.
                                  const overdue = getScheduleHealth(task) === 'DELAYED'
                                  return (
                                    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-[11px] text-gray-500 mb-2.5">
                                      <span className="inline-flex items-center gap-1">
                                        <span className={`w-2 h-2 rounded-full ${getPriorityColor(task.priority)}`} />
                                        <span className="font-medium text-gray-700 capitalize">{task.priority.toLowerCase()}</span>
                                      </span>
                                      {task.dueDate && (
                                        <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                                          <Clock className="h-3 w-3" />
                                          {format(new Date(task.dueDate), 'MMM dd')}
                                          <ScheduleHealthBadge task={task} compact />
                                        </span>
                                      )}
                                      {task.subtasks && task.subtasks.length > 0 && (
                                        <span className="inline-flex items-center gap-1">
                                          <ListTodo className="h-3 w-3" />
                                          {task.subtasks.filter(s => s.status === 'COMPLETED').length}/{task.subtasks.length}
                                        </span>
                                      )}
                                      {(task._count?.comments ?? 0) > 0 && (
                                        <span className="inline-flex items-center gap-1">
                                          <MessageSquare className="h-3 w-3" />
                                          {task._count!.comments}
                                        </span>
                                      )}
                                      {task.taskWeight != null && (
                                        <span className="inline-flex items-center gap-1" title="Importance/weight">
                                          <Star className="h-3 w-3" />
                                          {task.taskWeight}
                                        </span>
                                      )}
                                      {task.slaHours != null && (
                                        <span className="inline-flex items-center gap-1" title="SLA target">
                                          <Clock className="h-3 w-3" />
                                          {task.slaHours}h
                                        </span>
                                      )}
                                      {task.meetingLink && (
                                        <a
                                          href={task.meetingLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          title="Join meeting"
                                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                                        >
                                          <Video className="h-3 w-3" />
                                        </a>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* Assignees and Collaborators */}
                                <div className="space-y-1.5">
                                  {(() => {
                                    const people = getTaskAssignees(task)
                                    if (people.length === 0) return null
                                    return (
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex -space-x-1">
                                          {people.slice(0, 4).map((p) => (
                                            <UserAvatar key={p.id} userId={p.id} image={p.image} name={p.name} email={p.email}
                                              className="h-5 w-5 border border-background" fallbackClassName="text-[9px]" />
                                          ))}
                                          {people.length > 4 && (
                                            <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center border border-background">
                                              <span className="text-[9px]">+{people.length - 4}</span>
                                            </div>
                                          )}
                                        </div>
                                        {people.length === 1 && (
                                          <span className="text-xs text-muted-foreground truncate">{people[0].name || people[0].email}</span>
                                        )}
                                      </div>
                                    )
                                  })()}

                                </div>
                              </CardContent>
                            </Card>
                          )
                        }}
                        </Draggable>
                      ))}

                      {provided.placeholder}

                      {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                        <div className="flex flex-col items-center justify-center py-10 text-center text-gray-300 select-none pointer-events-none">
                          <ListTodo className="h-8 w-8 mb-2" />
                          <p className="text-xs font-medium">No tasks</p>
                          <p className="text-[10px]">Drag here or use +</p>
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </div>
      </DragDropContext>
      )}

      {viewMode === 'board' && tasks.length < totalTasks && (
        <div className="flex flex-col items-center gap-1.5 mt-6">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more tasks'}
          </Button>
          <span className="text-xs text-muted-foreground">Showing {tasks.length} of {totalTasks}</span>
        </div>
      )}

      {viewMode === 'timeline' && (
        <TimelineView
          tasks={tasks as any}
          zoom={timelineZoom}
          onZoomChange={setTimelineZoom}
          onTaskClick={(id) => {
            const t = tasks.find(x => x.id === id)
            if (t) handleTaskClick(t)
          }}
          canEdit={(id) => {
            const t = tasks.find(x => x.id === id)
            return t ? canUserChangeTaskStatus(t) : false
          }}
          onReschedule={handleReschedule}
        />
      )}

      {/* Load more — also in timeline view (it shares the paginated task list) */}
      {viewMode === 'timeline' && tasks.length < totalTasks && (
        <div className="flex flex-col items-center gap-1.5 mt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more tasks'}
          </Button>
          <span className="text-xs text-muted-foreground">Showing {tasks.length} of {totalTasks}</span>
        </div>
      )}

      {/* Duplicate Field Selector Dialog */}
      {pendingDuplicateTask && (
        <DuplicateTaskDialog
          open={showDuplicateDialog}
          onOpenChange={(open) => { setShowDuplicateDialog(open); if (!open) setPendingDuplicateTask(null) }}
          sourceTask={pendingDuplicateTask}
          onConfirm={handleDuplicateConfirm}
        />
      )}

      {/* Move task to another board */}
      <MoveToBoardDialog
        open={!!movingTask}
        onOpenChange={(open) => { if (!open) setMovingTask(null) }}
        taskIds={movingTask ? [movingTask.id] : []}
        currentBoardId={movingTask?.boardId}
        taskTitle={movingTask?.title}
        onMoved={() => { setMovingTask(null); fetchTasks(false); fetchBoards() }}
      />

      {/* Task Form Dialog */}
      <TaskForm
        open={showTaskForm}
        onOpenChange={closeTaskForm}
        task={editingTask}
        duplicateFrom={duplicatingTask}
        onSubmit={editingTask ? handleUpdateTask : handleCreateTask}
        boardContext={boardContext}
        boardFields={activeBoard?.fields || []}
        initialStatus={quickAddStatus}
        initialCustomStatusId={quickAddCustomStatusId}
      />

      {/* Type-to-confirm board deletion */}
      <ConfirmDeleteDialog
        open={!!boardPendingDelete}
        onOpenChange={(o) => { if (!o) setBoardPendingDelete(null) }}
        title="Delete board?"
        description={`This deletes the board "${boardPendingDelete?.name ?? ''}". Its tasks are kept and moved to All Tasks.`}
        confirmationText={boardPendingDelete?.name ?? ''}
        confirmLabel="Delete board"
        loading={deletingBoard}
        onConfirm={async () => {
          if (!boardPendingDelete) return
          setDeletingBoard(true)
          const ok = await deleteBoard(boardPendingDelete.id)
          setDeletingBoard(false)
          if (ok) setBoardPendingDelete(null)
        }}
      />

      <BulkTaskActionsDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        tasks={tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee,
        }))}
        onCompleted={fetchTasks}
      />

      {/* Backlog (archive) panel — tasks hidden from the board, restorable to To Do */}
      <Dialog open={showBacklog} onOpenChange={setShowBacklog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Archive className="h-5 w-5 text-slate-500" /> Backlog</DialogTitle>
            <DialogDescription>Archived tasks, hidden from the board. Restore one to move it back to To Do.</DialogDescription>
          </DialogHeader>
          {(() => {
            const backlog = tasks.filter(t => t.status === 'BACKLOG')
            if (backlog.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No tasks in the backlog.</p>
            return (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {backlog.map(t => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 hover:border-slate-300 transition-colors">
                    <button onClick={() => { setShowBacklog(false); handleTaskClick(t) }} className="flex-1 min-w-0 text-left">
                      <div className="text-sm font-medium text-slate-900 truncate">{t.title}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge className={`text-[10px] ${getPriorityColor(t.priority)} border font-medium`}>{t.priority}</Badge>
                        {t.team && <span className="text-[11px] text-slate-500 truncate">{t.team.name}</span>}
                      </div>
                    </button>
                    {canUserChangeTaskStatus(t) && (
                      <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => restoreFromBacklog(t)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {activeBoard?.canManage && (
        <BoardSettingsDialog
          boardId={activeBoard.id}
          boardName={activeBoard.name}
          statuses={activeBoard.statuses || []}
          fields={activeBoard.fields || []}
          members={((activeBoard.team ? activeBoard.team.members : activeBoard.members) || []).map(m => ({ id: m.user.id, name: m.user.name, email: m.user.email }))}
          open={boardSettingsOpen}
          onOpenChange={setBoardSettingsOpen}
          onChanged={async () => { await fetchBoards(); await fetchTasks(false) }}
        />
      )}

      {/* Unified Task View Modal */}
      <TaskViewModal
        open={showViewModal}
        onOpenChange={closeViewModal}
        task={viewingTask}
        onEdit={handleEditFromView}
        onDuplicate={(task) => { setShowViewModal(false); openDuplicateForm(task as Task) }}
        onMove={(task) => { setShowViewModal(false); setMovingTask(task as Task) }}
        onTaskUpdate={() => fetchTasks(false)}
        onSubtaskClick={handleSubtaskClick}
        onBack={taskHistory.length > 0 ? handleGoBack : undefined}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingTask} onOpenChange={(open) => { if (!open) { setDeletingTask(null); setDeleteScope('single') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingTask?.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletingTask?.recurringParentId && (
            <div className="px-1 space-y-2">
              <p className="text-sm font-medium text-gray-700">This is a recurring task. What would you like to delete?</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="deleteScope" value="single" checked={deleteScope === 'single'} onChange={() => setDeleteScope('single')} />
                  <span className="text-sm">This task only</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="deleteScope" value="series" checked={deleteScope === 'series'} onChange={() => setDeleteScope('series')} />
                  <span className="text-sm">Entire recurring series (all instances)</span>
                </label>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteScope === 'series' ? 'Delete Series' : 'Delete Task'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Board Dialog */}
      <Dialog open={showCreateBoard} onOpenChange={(open) => {
        setShowCreateBoard(open)
        if (!open) { setNewBoardName(''); setNewBoardDescription(''); setNewBoardColor('#3B82F6'); setNewBoardMemberIds([]) }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Kanban Board</DialogTitle>
            <DialogDescription>Give your board a name, color, and invite members who can see it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Board Name <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g. Team A, Marketing Sprint, Q2 Goals"
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createBoard() }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-gray-400 text-xs font-normal">(optional)</span></Label>
              <Input
                placeholder="What is this board for?"
                value={newBoardDescription}
                onChange={e => setNewBoardDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {BOARD_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewBoardColor(color)}
                    className={cn(
                      'w-8 h-8 rounded-full border-2 transition-transform hover:scale-110',
                      newBoardColor === color ? 'border-gray-800 scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <UserPlus className="h-4 w-4 text-gray-500" />
                Members <span className="text-gray-400 text-xs font-normal">(optional)</span>
              </Label>
              <SearchableMultiSelect
                options={users.filter(u => u.id !== session?.user?.id)}
                selected={users.filter(u => newBoardMemberIds.includes(u.id))}
                onSelect={opt => setNewBoardMemberIds(prev => [...prev, opt.id])}
                onRemove={id => setNewBoardMemberIds(prev => prev.filter(x => x !== id))}
                onClear={() => setNewBoardMemberIds([])}
                placeholder="Search members or leaders to add..."
              />
              {newBoardMemberIds.length > 0 && (
                <p className="text-xs text-gray-500">{newBoardMemberIds.length} person{newBoardMemberIds.length > 1 ? 's' : ''} will be able to view this board</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateBoard(false)}>Cancel</Button>
            <Button onClick={createBoard} disabled={!newBoardName.trim() || creatingBoard}>
              {creatingBoard ? 'Creating...' : 'Create Board'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Board Dialog */}
      {editingBoard && (
        <Dialog open={!!editingBoard} onOpenChange={(open) => { if (!open) { setEditingBoard(null); setEditingBoardMemberIds([]) } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Board</DialogTitle>
              <DialogDescription>Update the board name, color, and manage who can see it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Board Name</Label>
                <Input
                  value={editingBoard.name}
                  onChange={e => setEditingBoard({ ...editingBoard, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {BOARD_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEditingBoard({ ...editingBoard, color })}
                      className={cn(
                        'w-7 h-7 rounded-full border-2 transition-transform',
                        editingBoard.color === color ? 'border-gray-800 scale-110' : 'border-transparent'
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <UserPlus className="h-4 w-4 text-gray-500" />
                  Members
                </Label>
                <SearchableMultiSelect
                  options={users.filter(u => u.id !== session?.user?.id)}
                  selected={users.filter(u => editingBoardMemberIds.includes(u.id))}
                  onSelect={opt => setEditingBoardMemberIds(prev => [...prev, opt.id])}
                  onRemove={id => setEditingBoardMemberIds(prev => prev.filter(x => x !== id))}
                  onClear={() => setEditingBoardMemberIds([])}
                  placeholder="Search members or leaders..."
                />
                {editingBoardMemberIds.length > 0 ? (
                  <p className="text-xs text-gray-500">{editingBoardMemberIds.length} person{editingBoardMemberIds.length > 1 ? 's' : ''} can view this board</p>
                ) : (
                  <p className="text-xs text-gray-400">Only you can see this board</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditingBoard(null); setEditingBoardMemberIds([]) }}>Cancel</Button>
              <Button onClick={async () => {
                const res = await fetch(`/api/boards/${editingBoard.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: editingBoard.name,
                    color: editingBoard.color,
                    memberIds: editingBoardMemberIds,
                  }),
                })
                if (res.ok) {
                  const data = await res.json()
                  setBoards(prev => prev.map(b => b.id === editingBoard.id ? { ...b, ...data.board } : b))
                  setEditingBoard(null)
                  setEditingBoardMemberIds([])
                  toast({ title: 'Board updated' })
                }
              }}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
