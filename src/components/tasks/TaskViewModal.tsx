'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserAvatar } from '@/components/shared/UserAvatar'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { format, formatDistanceToNow } from 'date-fns'
import {
  User, Users, Handshake, Clock, MessageSquare, Send, Edit, Copy,
  Heart, ThumbsUp, Smile, Reply, Image, Paperclip, MoreHorizontal,
  AtSign, Trash2, Pencil, X, Check, FileText, Download, File,
  Plus, ListTodo, ChevronRight, ChevronLeft, CheckCircle2, Circle, AlertCircle, RefreshCw, RotateCcw, Eye, GitBranch, Lock, Repeat, FolderInput
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import { Progress } from '@/components/ui/progress'
import { splitMentions } from '@/lib/mentions'
import { describeRecurrence, type RecurringFrequency } from '@/lib/recurring'
import { ScheduleHealthBadge } from '@/components/tasks/ScheduleHealthBadge'

interface Task {
  id: string
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string
  startDate?: string
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
  progressPercentage: number
  taskType: 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION' | 'CASCADING'
  // Google Calendar fields
  location?: string
  meetingLink?: string
  allDay?: boolean
  recurrence?: string
  reminders?: any
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
  assignees?: Array<{
    userId: string
    user: {
      id: string
      name: string
      email: string
      image?: string
    }
  }>
  // Per-board custom field values
  fieldValues?: Array<{
    id: string
    fieldId: string
    value: string
    field?: { id: string; name: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'; options?: string[]; position?: number }
  }>
  // Server-computed viewer permissions (flat assignee model). Set by
  // /api/tasks (list) and /api/tasks/[id] (GET) so the client never
  // replicates completion/status permission logic.
  viewerCanComplete?: boolean
  viewerCanChangeStatus?: boolean
  // Subtask support
  parentId?: string | null
  parent?: {
    id: string
    title: string
  }
  // Recurring task support
  recurringParentId?: string | null
  isRecurring?: boolean
  // New feature fields
  memberSubmittedAt?: string | null
  leaderEvaluatedAt?: string | null
  workQuality?: string | null
  seniorWorkQuality?: string | null
  seniorEvaluatorId?: string | null
  seniorEvaluatedAt?: string | null
  taskWeight?: number | null
  slaHours?: number | null
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

interface CommentReaction {
  id: string
  emoji: string
  userId: string
  user: {
    id: string
    name: string
    email: string
  }
}

interface Comment {
  id: string
  content: string
  createdAt: string
  parentId?: string
  imageUrl?: string  // Legacy support
  fileUrl?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  author: {
    id: string
    name: string
    email: string
    image?: string
  }
  reactions: CommentReaction[]
  replies: Comment[]
}

interface Dependency {
  id: string
  title: string
  status: string
  priority: string
  dueDate?: string
}

interface Deliverable {
  id: string
  name: string
  description?: string
  isCompleted: boolean
  completedAt?: string
  submittedBy?: { id: string; name: string; email: string; image?: string }
}

interface Procurement {
  id: string
  type: 'PURCHASE_REQUEST' | 'PURCHASE_ORDER'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSED'
  notes?: string
  fileUrl?: string
  fileName?: string
  fileSize?: number
  fileType?: string
  createdBy: { id: string; name: string; email: string; image?: string }
  createdAt: string
}

interface TaskViewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
  onEdit?: (task: Task) => void
  onDuplicate?: (task: Task) => void
  onMove?: (task: Task) => void
  onTaskUpdate?: () => void | Promise<void>
  onSubtaskClick?: (subtaskId: string) => void
  onBack?: () => void
}

const REACTION_EMOJIS = ['👍', '❤️', '😄', '😮', '😢', '😡']

// Helper functions for file handling
const isImageFile = (fileType?: string, url?: string): boolean => {
  if (fileType) {
    return fileType.startsWith('image/')
  }
  // Fallback: check URL extension for legacy imageUrl
  if (url) {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '')
  }
  return false
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const getFileIcon = (fileType?: string) => {
  if (!fileType) return <File className="h-5 w-5" />
  if (fileType.startsWith('image/')) return <Image className="h-5 w-5" />
  if (fileType.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />
  if (fileType.includes('word') || fileType.includes('document')) return <FileText className="h-5 w-5 text-blue-500" />
  if (fileType.includes('sheet') || fileType.includes('excel')) return <FileText className="h-5 w-5 text-green-500" />
  if (fileType.includes('presentation') || fileType.includes('powerpoint')) return <FileText className="h-5 w-5 text-orange-500" />
  return <File className="h-5 w-5 text-gray-500" />
}

// Get effective file URL (supports both new fileUrl and legacy imageUrl)
const getEffectiveFileUrl = (comment: Comment): string | undefined => {
  return comment.fileUrl || comment.imageUrl
}

// Max length for any comment/reply/edit.
const COMMENT_MAX = 500

// Grow a textarea to fit its content (no inner scrollbar).
function autoGrowTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Live character counter that warns as the limit approaches / is reached.
function CharCount({ value, max = COMMENT_MAX }: { value: string; max?: number }) {
  const len = value.length
  const cls = len >= max ? 'text-red-600 font-semibold' : len >= max * 0.9 ? 'text-amber-600' : 'text-gray-400'
  return (
    <span className={`text-xs tabular-nums ${cls}`}>
      {len}/{max}{len >= max ? ' · limit reached' : ''}
    </span>
  )
}

export default function TaskViewModal({
  open,
  onOpenChange,
  task,
  onEdit,
  onDuplicate,
  onMove,
  onTaskUpdate,
  onSubtaskClick,
  onBack,
}: TaskViewModalProps) {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [mentionUsers, setMentionUsers] = useState<any[]>([])
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editFileInputRef = useRef<HTMLInputElement>(null)
  // Composer mention highlighting: a backdrop mirrors the textarea text with
  // @mentions highlighted live as you type; the textarea sits on top with
  // transparent text + visible caret, and their scroll positions stay in sync.
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const commentBackdropRef = useRef<HTMLDivElement>(null)
  // Auto-grow the comment composer to fit its content (incl. programmatic
  // changes like inserting an @mention), so it never shows an inner scrollbar.
  useEffect(() => { autoGrowTextarea(commentInputRef.current) }, [newComment])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [pendingFile, setPendingFile] = useState<{
    file: File
    fileUrl: string
    fileName: string
    fileType: string
    fileSize: number
  } | null>(null)

  // Edit/Delete comment state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentText, setEditCommentText] = useState('')
  const [editCommentFile, setEditCommentFile] = useState<{
    fileUrl: string | null
    fileName: string | null
    fileType: string | null
    fileSize: number | null
  } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)

  // Subtask state
  const [showAddSubtask, setShowAddSubtask] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [newSubtaskAssigneeId, setNewSubtaskAssigneeId] = useState<string>('')
  const [newSubtaskDeadline, setNewSubtaskDeadline] = useState<string>('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [localSubtasks, setLocalSubtasks] = useState<Task['subtasks']>([])
  const [availableUsers, setAvailableUsers] = useState<Array<{id: string, name: string, email: string, image?: string}>>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  // Viewer permissions from GET /api/tasks/[id] (authoritative once details load)
  const [viewerPerms, setViewerPerms] = useState<{ canComplete?: boolean; canChangeStatus?: boolean; canRate?: boolean }>({})

  // Progress editing state
  const [localProgress, setLocalProgress] = useState(0)
  const [savedProgress, setSavedProgress] = useState(0)
  const [savingProgress, setSavingProgress] = useState(false)
  const [savingReview, setSavingReview] = useState<null | 'approve' | 'sendBack'>(null)

  // Dependencies state
  const [dependencies, setDependencies] = useState<{ blockedBy: Dependency[]; blocking: Dependency[] }>({ blockedBy: [], blocking: [] })
  const [loadingDeps, setLoadingDeps] = useState(false)
  const [newDepTaskId, setNewDepTaskId] = useState('')
  const [addingDep, setAddingDep] = useState(false)
  const [depSearchQuery, setDepSearchQuery] = useState('')
  const [depSearchResults, setDepSearchResults] = useState<Dependency[]>([])

  // Attachments state
  const [attachments, setAttachments] = useState<Array<{ id: string; fileUrl: string; fileName: string; fileType?: string | null; fileSize?: number | null }>>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  // Deliverables state
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [loadingDeliverables, setLoadingDeliverables] = useState(false)
  const [newDeliverableName, setNewDeliverableName] = useState('')
  const [addingDeliverable, setAddingDeliverable] = useState(false)
  const [showAddDeliverable, setShowAddDeliverable] = useState(false)

  // Procurement state
  const [procurements, setProcurements] = useState<Procurement[]>([])
  const [loadingProcurement, setLoadingProcurement] = useState(false)
  const [showAddProcurement, setShowAddProcurement] = useState(false)
  const [newProcurement, setNewProcurement] = useState<{ type: 'PURCHASE_REQUEST' | 'PURCHASE_ORDER'; notes: string; file: File | null }>({ type: 'PURCHASE_REQUEST', notes: '', file: null })
  const [addingProcurement, setAddingProcurement] = useState(false)
  const procurementFileRef = useRef<HTMLInputElement>(null)

  // Work quality state
  const [savingQuality, setSavingQuality] = useState(false)

  // Due date override state
  const [showDueDateOverride, setShowDueDateOverride] = useState(false)
  const [newDueDate, setNewDueDate] = useState('')
  const [savingDueDate, setSavingDueDate] = useState(false)

  // Recurring series management state
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false)
  const [recurringSettings, setRecurringSettings] = useState<{
    id: string
    recurringFrequency: string | null
    recurringInterval: number | null
    recurringDaysOfWeek: number[]
    recurringEndDate: string | null
    startDate: string | null
    stopped: boolean
  } | null>(null)
  const [loadingRecurring, setLoadingRecurring] = useState(false)
  const [savingRecurring, setSavingRecurring] = useState(false)
  // Local editable copies of the settings shown in the dialog
  const [editFrequency, setEditFrequency] = useState<string>('WEEKLY')
  const [editInterval, setEditInterval] = useState<number>(1)
  const [editEndDate, setEditEndDate] = useState<string>('')
  const [editDaysOfWeek, setEditDaysOfWeek] = useState<number[]>([])

  // Load comments when task changes
  const fetchComments = async () => {
    if (!task?.id) return
    
    try {
      setLoadingComments(true)
      const response = await fetch(`/api/tasks/${task.id}/comments`)
      if (response.ok) {
        const data = await response.json()
        setComments(data.comments || [])
      }
    } catch (error) {
      console.error('Error fetching comments:', error)
    } finally {
      setLoadingComments(false)
    }
  }

  // Fetch users for mentions
  const fetchMentionUsers = async (query: string) => {
    if (!query.trim()) return []
    
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
      if (response.ok) {
        const data = await response.json()
        return data.users || []
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
    return []
  }

  // Fetch available users for subtask assignment
  const fetchAvailableUsers = async () => {
    try {
      setLoadingUsers(true)
      const response = await fetch('/api/user/team-members')
      if (response.ok) {
        const data = await response.json()
        setAvailableUsers(data.members || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoadingUsers(false)
    }
  }

  // Fetch full task data including subtasks
  const fetchTaskDetails = async () => {
    if (!task?.id) return

    try {
      const response = await fetch(`/api/tasks/${task.id}`)
      if (response.ok) {
        const fullTask = await response.json()
        setLocalSubtasks(fullTask.subtasks || [])
        setLocalProgress(fullTask.progressPercentage || 0)
        setSavedProgress(fullTask.progressPercentage || 0)
        // GET resolves isParentLeader (subtasks) that the list can't, so it's
        // the authoritative source for the viewer's completion permission.
        setViewerPerms({
          canComplete: fullTask.viewerCanComplete,
          canChangeStatus: fullTask.viewerCanChangeStatus,
          canRate: fullTask.viewerCanRate,
        })
      }
    } catch (error) {
      console.error('Error fetching task details:', error)
    }
  }

  const fetchDependencies = async () => {
    if (!task?.id) return
    try {
      setLoadingDeps(true)
      const res = await fetch(`/api/tasks/${task.id}/dependencies`)
      if (res.ok) setDependencies(await res.json())
    } catch (e) { console.error(e) } finally { setLoadingDeps(false) }
  }

  const fetchAttachments = async () => {
    if (!task?.id) return
    try {
      setLoadingAttachments(true)
      const res = await fetch(`/api/tasks/${task.id}/attachments`)
      if (res.ok) { const d = await res.json(); setAttachments(d.attachments || []) }
    } catch (e) { console.error(e) } finally { setLoadingAttachments(false) }
  }

  const fetchDeliverables = async () => {
    if (!task?.id) return
    try {
      setLoadingDeliverables(true)
      const res = await fetch(`/api/tasks/${task.id}/deliverables`)
      if (res.ok) { const d = await res.json(); setDeliverables(d.deliverables || []) }
    } catch (e) { console.error(e) } finally { setLoadingDeliverables(false) }
  }

  const fetchProcurements = async () => {
    if (!task?.id) return
    try {
      setLoadingProcurement(true)
      const res = await fetch(`/api/tasks/${task.id}/procurement`)
      if (res.ok) { const d = await res.json(); setProcurements(d.procurements || []) }
    } catch (e) { console.error(e) } finally { setLoadingProcurement(false) }
  }

  const handleAddDependency = async (dependsOnId: string) => {
    if (!task?.id || !dependsOnId || addingDep) return
    try {
      setAddingDep(true)
      const res = await fetch(`/api/tasks/${task.id}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOnId })
      })
      if (res.ok) {
        await fetchDependencies()
        setDepSearchQuery('')
        setDepSearchResults([])
        toast({ title: 'Dependency added' })
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) { console.error(e) } finally { setAddingDep(false) }
  }

  const handleRemoveDependency = async (dependsOnId: string) => {
    if (!task?.id) return
    const res = await fetch(`/api/tasks/${task.id}/dependencies?dependsOnId=${dependsOnId}`, { method: 'DELETE' })
    if (res.ok) { await fetchDependencies(); toast({ title: 'Dependency removed' }) }
  }

  const handleAddAttachmentFiles = async (files: FileList | null) => {
    if (!task?.id || !files || files.length === 0) return
    const list = Array.from(files)
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    setUploadingAttachment(true)
    try {
      for (const file of list) {
        const fd = new FormData()
        fd.append('file', file)
        const up = await fetch('/api/upload/task-file', { method: 'POST', body: fd })
        if (!up.ok) { const e = await up.json().catch(() => ({})); toast({ title: 'Upload failed', description: e.error, variant: 'destructive' }); continue }
        const meta = await up.json()
        const res = await fetch(`/api/tasks/${task.id}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: meta.fileUrl, fileName: meta.fileName, fileType: meta.fileType, fileSize: meta.fileSize }),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast({ title: 'Error', description: e.error, variant: 'destructive' }) }
      }
      await fetchAttachments()
    } finally { setUploadingAttachment(false) }
  }

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!task?.id) return
    const res = await fetch(`/api/tasks/${task.id}/attachments?attachmentId=${attachmentId}`, { method: 'DELETE' })
    if (res.ok) { await fetchAttachments(); toast({ title: 'Attachment removed' }) }
  }

  const handleToggleDeliverable = async (deliverable: Deliverable) => {
    if (!task?.id) return
    const newState = !deliverable.isCompleted
    // Optimistic update
    setDeliverables(prev => prev.map(d => d.id === deliverable.id ? { ...d, isCompleted: newState } : d))
    try {
      const res = await fetch(`/api/tasks/${task.id}/deliverables/${deliverable.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: newState })
      })
      if (res.ok) {
        const data = await res.json()
        await fetchDeliverables()
        if (data.autoAdvanced) {
          toast({ title: 'All deliverables complete!', description: 'Task moved to In Review automatically.' })
          onTaskUpdate?.()
        }
      } else {
        setDeliverables(prev => prev.map(d => d.id === deliverable.id ? { ...d, isCompleted: !newState } : d))
      }
    } catch (e) {
      setDeliverables(prev => prev.map(d => d.id === deliverable.id ? { ...d, isCompleted: !newState } : d))
    }
  }

  const handleAddDeliverable = async () => {
    if (!task?.id || !newDeliverableName.trim()) return
    try {
      setAddingDeliverable(true)
      const res = await fetch(`/api/tasks/${task.id}/deliverables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDeliverableName.trim() })
      })
      if (res.ok) {
        await fetchDeliverables()
        setNewDeliverableName('')
        setShowAddDeliverable(false)
        toast({ title: 'Deliverable added' })
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) { console.error(e) } finally { setAddingDeliverable(false) }
  }

  const handleDeleteDeliverable = async (id: string) => {
    if (!task?.id) return
    const res = await fetch(`/api/tasks/${task.id}/deliverables/${id}`, { method: 'DELETE' })
    if (res.ok) { await fetchDeliverables(); toast({ title: 'Deliverable removed' }) }
  }

  const handleAddProcurement = async () => {
    if (!task?.id) return
    try {
      setAddingProcurement(true)
      const formData = new FormData()
      formData.append('type', newProcurement.type)
      if (newProcurement.notes) formData.append('notes', newProcurement.notes)
      if (newProcurement.file) formData.append('file', newProcurement.file)
      const res = await fetch(`/api/tasks/${task.id}/procurement`, { method: 'POST', body: formData })
      if (res.ok) {
        await fetchProcurements()
        setNewProcurement({ type: 'PURCHASE_REQUEST', notes: '', file: null })
        if (procurementFileRef.current) procurementFileRef.current.value = ''
        setShowAddProcurement(false)
        toast({ title: 'PR/PO attached' })
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) { console.error(e) } finally { setAddingProcurement(false) }
  }

  const handleUpdateProcurementStatus = async (procId: string, status: Procurement['status']) => {
    if (!task?.id) return
    const res = await fetch(`/api/tasks/${task.id}/procurement/${procId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    if (res.ok) { await fetchProcurements(); toast({ title: 'Status updated' }) }
  }

  const handleSetWorkQuality = async (quality: string, isSenior = false) => {
    if (!task?.id) return
    try {
      setSavingQuality(true)
      const field = isSenior ? 'seniorWorkQuality' : 'workQuality'
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: quality })
      })
      if (res.ok) {
        toast({ title: isSenior ? 'Senior override saved' : 'Work quality saved' })
        onTaskUpdate?.()
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) { console.error(e) } finally { setSavingQuality(false) }
  }

  const searchTasksForDependency = async (q: string) => {
    if (!q.trim()) { setDepSearchResults([]); return }
    try {
      const res = await fetch(`/api/tasks?search=${encodeURIComponent(q)}&limit=10`)
      if (res.ok) {
        const data = await res.json()
        setDepSearchResults((data.tasks || []).filter((t: any) => t.id !== task?.id))
      }
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (open && task?.id) {
      // Clear the previously-viewed task's data immediately so a newly-opened
      // task never briefly shows the prior task's subtasks/comments while the
      // fetches below are still in flight (caused "subtasks on a task with none").
      setLocalSubtasks([])
      setComments([])
      // Reset to the prop-provided perms; fetchTaskDetails refreshes from GET.
      setViewerPerms({ canComplete: task.viewerCanComplete, canChangeStatus: task.viewerCanChangeStatus })
      fetchComments()
      fetchAvailableUsers()
      fetchTaskDetails()
      fetchDependencies()
      fetchAttachments()
      fetchDeliverables()
      fetchProcurements()
      setNewComment('')
      setReplyingTo(null)
      setReplyText('')
      setPendingFile(null)
      setEditingCommentId(null)
      setEditCommentFile(null)
      // Reset subtask state
      setShowAddSubtask(false)
      setNewSubtaskTitle('')
      setNewSubtaskAssigneeId('')
      setNewSubtaskDeadline('')
    }
    // Use task.id as dependency to prevent re-running when task object reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id])

  // Auto-fetch recurring settings when the modal opens for a recurring task,
  // so the cadence summary is visible without clicking "Manage recurrence".
  useEffect(() => {
    if (open && (task?.recurringParentId || task?.isRecurring)) {
      fetchRecurringSettings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id])

  // Approve a task that's IN_REVIEW: move it to COMPLETED.
  // Send back: bounce the task back to IN_PROGRESS for the assignee.
  // Both are gated to canCompleteTask (creator / assignedBy / ADMIN).
  const handleReviewDecision = async (decision: 'approve' | 'sendBack') => {
    if (!task?.id) return
    try {
      setSavingReview(decision)
      const body =
        decision === 'approve'
          ? { status: 'COMPLETED', progressPercentage: 100 }
          : { status: 'IN_PROGRESS' }
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update task')
      }
      toast({
        title: decision === 'approve' ? 'Task approved' : 'Sent back to assignee',
        description:
          decision === 'approve'
            ? 'The task has been marked as completed.'
            : 'The assignee has been asked to take another pass.',
      })
      onTaskUpdate?.()
      onOpenChange(false)
    } catch (error) {
      console.error('Error setting review decision:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update task',
        variant: 'destructive',
      })
    } finally {
      setSavingReview(null)
    }
  }

  // Handle progress update
  const handleProgressUpdate = async () => {
    if (!task?.id) return

    try {
      setSavingProgress(true)
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressPercentage: localProgress })
      })

      if (response.ok) {
        setSavedProgress(localProgress)
        toast({
          title: "Progress updated",
          description: `Progress set to ${localProgress}%`,
        })
        // Refresh the underlying task list without closing the modal, so the
        // user can keep working and immediately see the saved value reflected.
        onTaskUpdate?.()
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update progress')
      }
    } catch (error) {
      console.error('Error updating progress:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update progress",
        variant: "destructive",
      })
    } finally {
      setSavingProgress(false)
    }
  }

  // Handle adding a subtask
  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim() || !task?.id) return

    try {
      setAddingSubtask(true)
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newSubtaskTitle.trim(),
          parentId: task.id,
          priority: task.priority, // Inherit parent priority
          taskType: 'INDIVIDUAL',
          assigneeId: newSubtaskAssigneeId || session?.user?.id, // Use selected assignee or default to current user
          dueDate: newSubtaskDeadline ? new Date(newSubtaskDeadline).toISOString() : undefined,
        })
      })

      if (response.ok) {
        const newTask = await response.json()
        // Add to local subtasks
        setLocalSubtasks(prev => [...(prev || []), {
          id: newTask.id,
          title: newTask.title,
          status: newTask.status,
          priority: newTask.priority,
          progressPercentage: newTask.progressPercentage,
          dueDate: newTask.dueDate,
          assignee: newTask.assignee,
        }])
        setNewSubtaskTitle('')
        setNewSubtaskAssigneeId('')
        setNewSubtaskDeadline('')
        setShowAddSubtask(false)
        toast({
          title: "Subtask created",
          description: "Your subtask has been added successfully.",
        })
        // Notify parent to refresh
        onTaskUpdate?.()
        // Refresh so the parent switches to subtask-derived progress consistently.
        fetchTaskDetails()
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create subtask')
      }
    } catch (error) {
      console.error('Error creating subtask:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create subtask. Please try again.",
        variant: "destructive",
      })
    } finally {
      setAddingSubtask(false)
    }
  }

  // Toggle subtask completion.
  // - The creator/assigner/admin (canCompleteTask) can finalize: COMPLETED (100%) <-> TODO.
  // - Anyone else (the member doing the work) submits for review: IN_REVIEW (90%) <-> TODO.
  //   They never set COMPLETED directly — the leader/creator reviews and marks it done.
  const handleToggleSubtaskCompletion = async (subtask: NonNullable<Task['subtasks']>[number]) => {
    let newStatus: 'TODO' | 'IN_REVIEW' | 'COMPLETED'
    let newProgress: number
    let successMessage: string

    if (canCompleteTask) {
      const isCompleted = subtask.status === 'COMPLETED'
      newStatus = isCompleted ? 'TODO' : 'COMPLETED'
      newProgress = isCompleted ? 0 : 100
      successMessage = isCompleted ? 'Subtask reopened' : 'Subtask marked complete'
    } else {
      const submitted = subtask.status === 'IN_REVIEW'
      newStatus = submitted ? 'TODO' : 'IN_REVIEW'
      newProgress = submitted ? 0 : 90
      successMessage = submitted ? 'Submission withdrawn' : 'Submitted for review'
    }

    // Optimistic update
    setLocalSubtasks(prev =>
      (prev || []).map(s =>
        s.id === subtask.id ? { ...s, status: newStatus as typeof s.status, progressPercentage: newProgress } : s
      )
    )

    try {
      const response = await fetch(`/api/tasks/${subtask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, progressPercentage: newProgress }),
      })

      if (!response.ok) {
        throw new Error('Failed to update subtask')
      }
      toast({ title: successMessage })
      onTaskUpdate?.()
      // Refresh so the parent's server-rolled-up progress (% + bar) stays in
      // sync with the subtask completion caption.
      fetchTaskDetails()
    } catch (error) {
      // Revert optimistic update on failure
      setLocalSubtasks(prev =>
        (prev || []).map(s =>
          s.id === subtask.id ? { ...s, status: subtask.status, progressPercentage: subtask.progressPercentage } : s
        )
      )
      toast({
        title: 'Error',
        description: 'Failed to update subtask. Please try again.',
        variant: 'destructive',
      })
    }
  }

  // Handle mentions in comment text
  const handleCommentChange = async (text: string) => {
    setNewComment(text)
    
    const atIndex = text.lastIndexOf('@')
    if (atIndex !== -1) {
      const mentionText = text.slice(atIndex + 1)
      if (mentionText.length > 0) {
        setMentionQuery(mentionText)
        const users = await fetchMentionUsers(mentionText)
        setMentionUsers(users)
        setShowMentions(true)
      } else {
        setShowMentions(false)
      }
    } else {
      setShowMentions(false)
    }
  }

  const handleMentionSelect = (user: any) => {
    const atIndex = newComment.lastIndexOf('@')
    const newText = newComment.slice(0, atIndex) + `@${user.name} `
    setNewComment(newText)
    setShowMentions(false)
  }

  const handleFileUpload = async (file: File): Promise<{
    fileUrl: string
    fileName: string
    fileType: string
    fileSize: number
  } | null> => {
    if (!file || !task?.id) return null

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 50MB.",
        variant: "destructive",
      })
      return null
    }

    try {
      setUploadingFile(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('taskId', task.id)

      const response = await fetch('/api/upload/comment-file', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        const data = await response.json()
        return {
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileType: data.fileType,
          fileSize: data.fileSize
        }
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }
    } catch (error) {
      console.error('Error uploading file:', error)
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload file. Please try again.",
        variant: "destructive",
      })
    } finally {
      setUploadingFile(false)
    }
    return null
  }

  const handleAddComment = async (parentId?: string) => {
    const text = parentId ? replyText : newComment
    // Allow posting if there's text OR a pending file
    if ((!text.trim() && !pendingFile) || !task?.id) return

    try {
      setSubmittingComment(true)

      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text.trim(),
          parentId,
          ...(pendingFile && {
            fileUrl: pendingFile.fileUrl,
            fileName: pendingFile.fileName,
            fileType: pendingFile.fileType,
            fileSize: pendingFile.fileSize,
          })
        })
      })

      if (response.ok) {
        const comment = await response.json()

        if (parentId) {
          // Add reply to existing comment
          setComments(prev => prev.map(c =>
            c.id === parentId
              ? { ...c, replies: [comment, ...c.replies] }
              : c
          ))
          setReplyText('')
          setReplyingTo(null)
        } else {
          // Add new comment
          setComments(prev => [comment, ...prev])
          setNewComment('')
          setPendingFile(null)
        }

        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }

        toast({
          title: "Comment posted",
          description: "Your comment has been added successfully.",
        })
      } else {
        throw new Error('Failed to add comment')
      }
    } catch (error) {
      console.error('Error adding comment:', error)
      toast({
        title: "Error",
        description: "Failed to post comment. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleReaction = async (commentId: string, emoji: string) => {
    try {
      const response = await fetch(`/api/comments/${commentId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
      })

      if (response.ok) {
        // Refresh comments to get updated reactions
        fetchComments()
      }
    } catch (error) {
      console.error('Error adding reaction:', error)
    }
  }

  // Start editing a comment
  const startEditingComment = (comment: Comment) => {
    setEditingCommentId(comment.id)
    setEditCommentText(comment.content)
    // Support both new fileUrl and legacy imageUrl
    const effectiveUrl = comment.fileUrl || comment.imageUrl
    setEditCommentFile(effectiveUrl ? {
      fileUrl: effectiveUrl,
      fileName: comment.fileName || null,
      fileType: comment.fileType || null,
      fileSize: comment.fileSize || null
    } : null)
  }

  // Cancel editing
  const cancelEditing = () => {
    setEditingCommentId(null)
    setEditCommentText('')
    setEditCommentFile(null)
    if (editFileInputRef.current) {
      editFileInputRef.current.value = ''
    }
  }

  // Handle edit file upload
  const handleEditFileUpload = async (file: File) => {
    if (!file || !task?.id) return null

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 50MB.",
        variant: "destructive",
      })
      return null
    }

    try {
      setUploadingFile(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('taskId', task.id)

      const response = await fetch('/api/upload/comment-file', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        const data = await response.json()
        setEditCommentFile({
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileType: data.fileType,
          fileSize: data.fileSize
        })
        return data
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }
    } catch (error) {
      console.error('Error uploading file:', error)
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload file. Please try again.",
        variant: "destructive",
      })
    } finally {
      setUploadingFile(false)
    }
    return null
  }

  // Save edited comment
  const handleSaveEdit = async (commentId: string) => {
    if (!editCommentText.trim()) return

    try {
      setSavingEdit(true)
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editCommentText.trim(),
          fileUrl: editCommentFile?.fileUrl ?? null,
          fileName: editCommentFile?.fileName ?? null,
          fileType: editCommentFile?.fileType ?? null,
          fileSize: editCommentFile?.fileSize ?? null,
        })
      })

      if (response.ok) {
        const updatedComment = await response.json()

        // Update the comment in state
        setComments(prev => prev.map(c => {
          if (c.id === commentId) {
            return updatedComment
          }
          // Check if it's a reply
          if (c.replies) {
            return {
              ...c,
              replies: c.replies.map(r => r.id === commentId ? updatedComment : r)
            }
          }
          return c
        }))

        cancelEditing()
        toast({
          title: "Comment updated",
          description: "Your comment has been updated successfully.",
        })
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update comment')
      }
    } catch (error) {
      console.error('Error updating comment:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update comment. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSavingEdit(false)
    }
  }

  // Delete a comment
  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return

    try {
      setDeletingCommentId(commentId)
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // Remove the comment from state
        setComments(prev => {
          // First check if it's a top-level comment
          const filtered = prev.filter(c => c.id !== commentId)

          // Also check if it's a reply
          return filtered.map(c => ({
            ...c,
            replies: c.replies ? c.replies.filter(r => r.id !== commentId) : []
          }))
        })

        toast({
          title: "Comment deleted",
          description: "The comment has been deleted successfully.",
        })
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete comment')
      }
    } catch (error) {
      console.error('Error deleting comment:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete comment. Please try again.",
        variant: "destructive",
      })
    } finally {
      setDeletingCommentId(null)
    }
  }

  const handleEdit = () => {
    if (task && onEdit) {
      onEdit(task)
      onOpenChange(false)
    }
  }

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'INDIVIDUAL': return <User className="h-4 w-4" />
      case 'TEAM': return <Users className="h-4 w-4" />
      case 'COLLABORATION': return <Handshake className="h-4 w-4" />
      case 'CASCADING': return <GitBranch className="h-4 w-4" />
      default: return <User className="h-4 w-4" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'text-red-600 bg-red-50'
      case 'HIGH': return 'text-orange-600 bg-orange-50'
      case 'MEDIUM': return 'text-yellow-600 bg-yellow-50'
      case 'LOW': return 'text-green-600 bg-green-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'TODO': return 'text-gray-600 bg-gray-50'
      case 'IN_PROGRESS': return 'text-blue-600 bg-blue-50'
      case 'IN_REVIEW': return 'text-yellow-600 bg-yellow-50'
      case 'COMPLETED': return 'text-green-600 bg-green-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  // Names of everyone involved in the task — used to highlight @mentions in
  // comment text. Plain const (not a hook) so it can't perturb hook ordering.
  const mentionNames = Array.from(
    new Set(
      [
        task?.assignee?.name,
        task?.creator?.name,
        ...(task?.teamMembers?.map(tm => tm.user?.name) ?? []),
        ...(task?.collaborators?.map(c => c.user?.name) ?? []),
        ...availableUsers.map(u => u.name),
      ].filter((n): n is string => !!n && n.trim().length > 0)
    )
  )

  // Render comment text with @mentions highlighted.
  const renderCommentBody = (content: string) =>
    splitMentions(content, mentionNames).map((seg, i) =>
      seg.isMention ? (
        <span key={i} className="font-semibold text-blue-600 bg-blue-50 rounded px-0.5">
          {seg.value}
        </span>
      ) : (
        <span key={i}>{seg.value}</span>
      )
    )

  const isTaskCreator = task?.creator?.id === session?.user?.id
  const isTaskAssignee =
    task?.assignee?.id === session?.user?.id ||
    (task?.assignees?.some(a => a.user?.id === session?.user?.id) ?? false)
  const isTaskAssigner = task?.assignedBy?.id === session?.user?.id
  // Completion permission is computed server-side (flat assignee model): the
  // GET-derived value is authoritative once details load, the list-provided
  // value covers initial render, and a narrow legacy subset is the fallback if
  // neither is present. Board-leader/parent-leader detection lives only on the
  // server — never replicated here.
  const canCompleteTask =
    viewerPerms.canComplete ??
    task?.viewerCanComplete ??
    (isTaskCreator || isTaskAssigner || session?.user?.role === 'ADMIN')
  // Rating is broader than completion: every LEADER in the task's board may rate
  // a member's work. The server (GET /api/tasks/[id]) is authoritative and
  // verifies board access; before it loads, fall back to completion permission.
  const canRateWork =
    viewerPerms.canRate ??
    (task as any)?.viewerCanRate ??
    canCompleteTask
  const isTaskTeamMember = task?.teamMembers?.some(tm => tm.user.id === session?.user?.id)
  const isTaskCollaborator = task?.collaborators?.some(c => c.user.id === session?.user?.id)

  // Users who can add subtasks: creator, assignee, team members, collaborators
  const canAddSubtasks = isTaskCreator || isTaskAssignee || isTaskTeamMember || isTaskCollaborator

  // Anyone involved in the task can add or edit its dependencies: the creator,
  // assignee(s), the assigner, team members, collaborators — plus admins and
  // anyone with finisher permission (board/parent leaders, computed server-side).
  const canEditDependencies =
    canCompleteTask ||
    isTaskCreator ||
    isTaskAssignee ||
    isTaskAssigner ||
    isTaskTeamMember ||
    isTaskCollaborator ||
    session?.user?.role === 'ADMIN'

  // ── Progress management ──
  // Parent tasks derive progress from their subtasks (server rolls it up), so the
  // manual control is only meaningful for leaf tasks. Non-finishers cap at 90% —
  // the assigner sets the final 100% when approving the review.
  const hasSubtasks = (localSubtasks?.length ?? 0) > 0
  const completedSubtasks = (localSubtasks ?? []).filter(s => s.status === 'COMPLETED').length
  const maxProgress = canCompleteTask ? 100 : 90
  const canEditProgress = canAddSubtasks && !hasSubtasks && task?.status !== 'COMPLETED'
  const progressDirty = localProgress !== savedProgress
  const displayProgress = (hasSubtasks || !canEditProgress) ? savedProgress : localProgress
  const progressFillColor = (pct: number) =>
    pct >= 100 ? 'bg-emerald-500'
      : pct >= 75 ? 'bg-blue-500'
      : pct >= 40 ? 'bg-amber-500'
      : pct > 0 ? 'bg-orange-500'
      : 'bg-slate-300'
  // Hex of the above, for the editable slider's gradient track.
  const progressFillHex = (pct: number) =>
    pct >= 100 ? '#10b981'
      : pct >= 75 ? '#3b82f6'
      : pct >= 40 ? '#f59e0b'
      : pct > 0 ? '#f97316'
      : '#cbd5e1'
  const progressTextColor = (pct: number) =>
    pct >= 100 ? 'text-emerald-600'
      : pct >= 75 ? 'text-blue-600'
      : pct >= 40 ? 'text-amber-600'
      : pct > 0 ? 'text-orange-600'
      : 'text-slate-500'
  const PROGRESS_PRESETS = [0, 25, 50, 75, maxProgress]

  const renderComment = (comment: Comment, isReply = false) => {
    const isAuthor = comment.author.id === session?.user?.id
    const canDelete = isAuthor || isTaskCreator || session?.user?.role === 'ADMIN'
    const isEditing = editingCommentId === comment.id
    const isDeleting = deletingCommentId === comment.id

    return (
      <div key={comment.id} className={`${isReply ? 'ml-10' : ''} space-y-3`}>
        <div className="flex gap-3">
          <UserAvatar
            userId={comment.author.id}
            image={comment.author.image}
            name={comment.author.name}
            email={comment.author.email}
            className="h-8 w-8 flex-shrink-0"
            fallbackClassName="text-sm"
          />
          <div className="flex-1 space-y-2">
            {isEditing ? (
              /* Edit Mode UI */
              <div className="bg-blue-50 rounded-lg p-3 space-y-3">
                <Textarea
                  ref={autoGrowTextarea}
                  value={editCommentText}
                  maxLength={COMMENT_MAX}
                  onChange={(e) => setEditCommentText(e.target.value)}
                  onInput={(e) => autoGrowTextarea(e.currentTarget)}
                  className="min-h-[60px] max-h-[40vh] resize-none text-sm bg-white"
                  placeholder="Edit your comment..."
                />
                <div className="flex justify-end"><CharCount value={editCommentText} /></div>

                {/* Edit File Section */}
                <div className="space-y-2">
                  {editCommentFile?.fileUrl && (
                    <div className="relative inline-block">
                      {isImageFile(editCommentFile.fileType || undefined, editCommentFile.fileUrl) ? (
                        <img
                          src={editCommentFile.fileUrl}
                          alt="Comment attachment"
                          className="max-w-xs rounded-lg border"
                        />
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-white rounded-lg border">
                          {getFileIcon(editCommentFile.fileType || undefined)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {editCommentFile.fileName || 'Attached file'}
                            </p>
                            {editCommentFile.fileSize && (
                              <p className="text-xs text-gray-500">
                                {formatFileSize(editCommentFile.fileSize)}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => setEditCommentFile(null)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                        title="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <input
                    ref={editFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleEditFileUpload(file)
                    }}
                  />

                  {!editCommentFile && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editFileInputRef.current?.click()}
                      disabled={uploadingFile}
                      className="text-gray-500"
                    >
                      {uploadingFile ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-500 mr-1" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Paperclip className="h-4 w-4 mr-1" />
                          Attach File
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* Edit Actions */}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelEditing}
                    disabled={savingEdit}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSaveEdit(comment.id)}
                    disabled={!editCommentText.trim() || savingEdit}
                  >
                    {savingEdit ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              /* Normal View Mode */
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {comment.author.name || comment.author.email}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </span>
                  </div>

                  {/* Edit/Delete Menu */}
                  {(isAuthor || canDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isAuthor && (
                          <DropdownMenuItem onClick={() => startEditingComment(comment)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-red-600 focus:text-red-600"
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {renderCommentBody(comment.content)}
                </p>
                {/* File Attachment Display - supports both new fileUrl and legacy imageUrl */}
                {(() => {
                  const effectiveUrl = getEffectiveFileUrl(comment)
                  if (!effectiveUrl) return null

                  const isImage = isImageFile(comment.fileType, effectiveUrl)

                  if (isImage) {
                    return (
                      <img
                        src={effectiveUrl}
                        alt="Comment attachment"
                        className="mt-2 max-w-xs rounded-lg border cursor-pointer hover:opacity-90"
                        onClick={() => window.open(effectiveUrl, '_blank')}
                      />
                    )
                  }

                  // Non-image file display
                  return (
                    <a
                      href={effectiveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-3 p-3 bg-gray-100 rounded-lg border hover:bg-gray-200 transition-colors max-w-xs"
                    >
                      {getFileIcon(comment.fileType)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {comment.fileName || 'Attached file'}
                        </p>
                        {comment.fileSize && (
                          <p className="text-xs text-gray-500">
                            {formatFileSize(comment.fileSize)}
                          </p>
                        )}
                      </div>
                      <Download className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    </a>
                  )
                })()}
              </div>
            )}

            {/* Reactions - Only show when not editing */}
            {!isEditing && (
              <div className="flex items-center gap-3">
                {/* Existing reactions display */}
                <div className="flex items-center gap-1">
                  {REACTION_EMOJIS.map(emoji => {
                    const reactionCount = comment.reactions?.filter(r => r.emoji === emoji).length || 0
                    const hasReacted = comment.reactions?.some(r => r.emoji === emoji && r.userId === session?.user?.id)

                    if (reactionCount === 0 && !hasReacted) return null

                    return (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(comment.id, emoji)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-sm font-medium transition-all hover:scale-105 ${
                          hasReacted
                            ? 'bg-blue-50 text-blue-700 border-2 border-blue-200 shadow-sm'
                            : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200'
                        }`}
                      >
                        <span className="text-base">{emoji}</span>
                        <span className="text-xs font-semibold">{reactionCount}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Add reaction button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    >
                      <Smile className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-auto p-2">
                    <div className="flex items-center gap-1">
                      {REACTION_EMOJIS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(comment.id, emoji)}
                          className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 transition-colors"
                        >
                          <span className="text-lg">{emoji}</span>
                        </button>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {!isReply && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplyingTo(comment.id)}
                    className="h-6 px-2 text-xs text-gray-500"
                  >
                    <Reply className="h-3 w-3 mr-1" />
                    Reply
                  </Button>
                )}
              </div>
            )}

            {/* Reply form */}
            {replyingTo === comment.id && (
              <div className="space-y-2">
                <Textarea
                  ref={autoGrowTextarea}
                  placeholder="Write a reply..."
                  value={replyText}
                  maxLength={COMMENT_MAX}
                  onChange={(e) => setReplyText(e.target.value)}
                  onInput={(e) => autoGrowTextarea(e.currentTarget)}
                  className="min-h-[60px] max-h-[40vh] resize-none text-sm"
                />
                <div className="flex items-center justify-end gap-2">
                  <span className="mr-auto"><CharCount value={replyText} /></span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReplyingTo(null)
                      setReplyText('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleAddComment(comment.id)}
                    disabled={!replyText.trim() || submittingComment}
                    size="sm"
                  >
                    Reply
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Render replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="space-y-3">
            {comment.replies.map(reply => renderComment(reply, true))}
          </div>
        )}
      </div>
    )
  }

  // Recurring series helpers
  const isRecurringTask = !!(task?.recurringParentId || task?.isRecurring)

  const fetchRecurringSettings = async () => {
    if (!task?.id) return
    try {
      setLoadingRecurring(true)
      const res = await fetch(`/api/tasks/${task.id}/recurring`)
      if (res.ok) {
        const data = await res.json()
        setRecurringSettings(data)
        setEditFrequency(data.recurringFrequency ?? 'WEEKLY')
        setEditInterval(data.recurringInterval ?? 1)
        setEditEndDate(data.recurringEndDate ? data.recurringEndDate.split('T')[0] : '')
        setEditDaysOfWeek(data.recurringDaysOfWeek ?? [])
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) {
      console.error('Error fetching recurring settings:', e)
    } finally {
      setLoadingRecurring(false)
    }
  }

  const handleOpenRecurringDialog = async () => {
    setRecurringDialogOpen(true)
    await fetchRecurringSettings()
  }

  const handleStopRecurring = async () => {
    if (!task?.id) return
    try {
      setSavingRecurring(true)
      const res = await fetch(`/api/tasks/${task.id}/recurring`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stop: true }),
      })
      if (res.ok) {
        const data = await res.json()
        setRecurringSettings(data)
        toast({ title: 'Recurring stopped', description: 'No new instances will be created.' })
        setRecurringDialogOpen(false)
        onTaskUpdate?.()
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) {
      console.error('Error stopping recurring:', e)
      toast({ title: 'Error', description: 'Failed to stop recurring series.', variant: 'destructive' })
    } finally {
      setSavingRecurring(false)
    }
  }

  const handleSaveRecurring = async () => {
    if (!task?.id) return
    try {
      setSavingRecurring(true)
      const body: Record<string, unknown> = {
        recurringFrequency: editFrequency,
        recurringInterval: editInterval,
        recurringDaysOfWeek: editDaysOfWeek,
        // null means "clear end date = indefinite"
        recurringEndDate: editEndDate || null,
      }
      const res = await fetch(`/api/tasks/${task.id}/recurring`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setRecurringSettings(data)
        toast({ title: 'Recurrence updated', description: 'Series settings have been saved.' })
        setRecurringDialogOpen(false)
        onTaskUpdate?.()
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error, variant: 'destructive' })
      }
    } catch (e) {
      console.error('Error saving recurring settings:', e)
      toast({ title: 'Error', description: 'Failed to save recurrence settings.', variant: 'destructive' })
    } finally {
      setSavingRecurring(false)
    }
  }

  if (!task) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Simple Header */}
        <DialogHeader className="space-y-3 pr-8 overflow-hidden">
          {/* Back button — shown when navigated into a subtask */}
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-fit -mb-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to parent task
            </button>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                <span className="flex-shrink-0 mt-1">{getTaskTypeIcon(task.taskType)}</span>
                <DialogTitle className="text-xl font-semibold break-words min-w-0">
                  {task.title}
                </DialogTitle>
              </div>
              <DialogDescription className="text-sm text-gray-600">
                Created by {task.creator?.name || task.creator?.email || 'Unknown'} on {format(new Date(task.createdAt), 'MMM dd, yyyy')}
                {task.assignedBy && task.assignedBy.id !== task.creator?.id && (
                  <> • Assigned by {task.assignedBy.name || task.assignedBy.email}</>
                )}
              </DialogDescription>
            </div>

            {/* Action buttons - positioned to avoid X button overlap */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {onDuplicate && (
                <Button variant="outline" size="sm" onClick={() => { onDuplicate(task); onOpenChange(false) }}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </Button>
              )}
              {onMove && (
                <Button variant="outline" size="sm" onClick={() => { onMove(task); onOpenChange(false) }}>
                  <FolderInput className="h-4 w-4 mr-2" />
                  Move
                </Button>
              )}
              {(canCompleteTask || isTaskAssignee) && (
                <Button variant="outline" size="sm" onClick={handleEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          </div>

          {/* Status and Priority Badges */}
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className={getPriorityColor(task.priority)}>
              {task.priority}
            </Badge>
            <Badge variant="secondary" className={getStatusColor(task.status)}>
              {formatStatus(task.status)}
            </Badge>
            <Badge variant="outline">
              {task.taskType.replace('_', ' ')}
            </Badge>
          </div>

          {/* Review banner — appears for the assigner / creator / admin when a
              task is sitting in IN_REVIEW awaiting their decision. */}
          {task.status === 'IN_REVIEW' && canCompleteTask && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm text-amber-900">
                <Eye className="h-4 w-4 shrink-0" />
                <span>
                  This task is awaiting your review.
                  {task.memberSubmittedAt && (
                    <span className="text-amber-700 ml-1">
                      Submitted {formatDistanceToNow(new Date(task.memberSubmittedAt), { addSuffix: true })}.
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReviewDecision('sendBack')}
                  disabled={savingReview !== null}
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  {savingReview === 'sendBack' ? 'Sending…' : 'Send back'}
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => handleReviewDecision('approve')}
                  disabled={savingReview !== null}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {savingReview === 'approve' ? 'Approving…' : 'Approve'}
                </Button>
              </div>
            </div>
          )}

          {/* Progress — derived for parent tasks, editable for leaf tasks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</span>
              <span className={`text-lg font-bold tabular-nums ${progressTextColor(displayProgress)}`}>
                {displayProgress}%
              </span>
            </div>

            {hasSubtasks ? (
              /* Parent task: rolled-up, read-only bar + caption */
              <>
                <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${progressFillColor(displayProgress)}`}
                    style={{ width: `${displayProgress}%` }}
                  />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <ListTodo className="h-3.5 w-3.5 shrink-0" />
                  Auto-calculated from subtasks · {completedSubtasks} of {localSubtasks?.length ?? 0} complete
                </p>
              </>
            ) : canEditProgress ? (
              /* Leaf task: ONE control — the slider's filled track IS the bar */
              <div className="space-y-3 pt-0.5">
                {/* Merged control: drag the bar; its fill shows the value */}
                <input
                  type="range"
                  min={0}
                  max={maxProgress}
                  step={5}
                  value={localProgress}
                  onChange={(e) => setLocalProgress(Number(e.target.value))}
                  style={{ background: `linear-gradient(to right, ${progressFillHex(localProgress)} ${localProgress}%, #e2e8f0 ${localProgress}%)` }}
                  className="w-full h-2.5 appearance-none rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-400 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-400 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:cursor-pointer"
                />

                {/* Quick-set presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {PROGRESS_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setLocalProgress(p)}
                      className={`px-2.5 h-7 rounded-md text-xs font-semibold border transition-colors ${
                        localProgress === p
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                      }`}
                    >
                      {p === 100 ? 'Complete' : `${p}%`}
                    </button>
                  ))}
                </div>

                {/* Caption + dirty-state save */}
                <div className="flex items-center justify-between gap-2 min-h-[28px]">
                  <p className="text-xs text-slate-400 leading-snug">
                    {!canCompleteTask
                      ? 'You can set up to 90% — your reviewer marks it 100% on approval.'
                      : 'Pick a preset or drag to set your progress.'}
                  </p>
                  {progressDirty && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
                        onClick={() => setLocalProgress(savedProgress)}
                        disabled={savingProgress}
                      >
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs"
                        onClick={handleProgressUpdate}
                        disabled={savingProgress}
                      >
                        {savingProgress ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5" />
                            Saving…
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Save
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Read-only leaf: static display bar */
              <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${progressFillColor(displayProgress)}`}
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="space-y-4">
          {/* Description */}
          {task.description && (
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Description</h4>
              <p className="text-gray-700 leading-relaxed">{task.description}</p>
            </div>
          )}

          {/* Due Date */}
          {task.dueDate && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">Due:</span>
                <span className="font-medium">{format(new Date(task.dueDate), 'EEEE, MMM dd, yyyy')}</span>
                <ScheduleHealthBadge task={task} className="ml-2" />
                {/* Leader can extend due date for assignees */}
                {(canCompleteTask || session?.user?.role === 'LEADER') && task.status !== 'COMPLETED' && (
                  <button
                    onClick={() => { setShowDueDateOverride(v => !v); setNewDueDate(task.dueDate ? task.dueDate.split('T')[0] : '') }}
                    className="text-xs text-blue-500 hover:text-blue-700 underline ml-1"
                  >
                    {showDueDateOverride ? 'Cancel' : 'Extend'}
                  </button>
                )}
              </div>
              {showDueDateOverride && (
                <div className="flex items-center gap-2 ml-6">
                  <input
                    type="date"
                    value={newDueDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="text-xs border rounded px-2 py-1 h-7"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!newDueDate || savingDueDate}
                    onClick={async () => {
                      if (!newDueDate || !task.id) return
                      setSavingDueDate(true)
                      try {
                        const res = await fetch(`/api/tasks/${task.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dueDate: new Date(newDueDate).toISOString() })
                        })
                        if (res.ok) {
                          toast({ title: 'Due date updated' })
                          setShowDueDateOverride(false)
                          onTaskUpdate?.()
                        } else {
                          const err = await res.json()
                          toast({ title: 'Error', description: err.error, variant: 'destructive' })
                        }
                      } catch (e) { console.error(e) } finally { setSavingDueDate(false) }
                    }}
                  >
                    {savingDueDate ? 'Saving...' : <Check className="h-3 w-3" />}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* SLA + Weight display */}
          {(task.slaHours || task.taskWeight) && (
            <div className="flex items-center gap-3 text-xs flex-wrap">
              {task.taskWeight && (
                <span className="flex items-center gap-1 text-amber-600">
                  {'★'.repeat(task.taskWeight)}{'☆'.repeat(5 - task.taskWeight)}
                  <span className="text-gray-500 ml-1">Weight {task.taskWeight}/5</span>
                </span>
              )}
              {task.slaHours && (() => {
                const createdMs = new Date(task.createdAt).getTime()
                const slaDeadline = new Date(createdMs + task.slaHours! * 60 * 60 * 1000)
                const breached = new Date() > slaDeadline && task.status !== 'COMPLETED'
                const slaDays = task.slaHours! >= 168 ? `${task.slaHours! / 168}w` : task.slaHours! >= 24 ? `${task.slaHours! / 24}d` : `${task.slaHours!}h`
                return (
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${breached ? 'bg-red-50 text-red-700 border-red-200 font-semibold' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {breached ? '⚠ SLA Breached' : `SLA: ${slaDays}`}
                  </span>
                )
              })()}
            </div>
          )}

          {/* Recurring Series Section */}
          {isRecurringTask && (
            <div className="border-t pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Repeat className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-gray-900">Recurring</span>
                  {recurringSettings && (
                    <span className="text-gray-500 text-xs">
                      {recurringSettings.stopped
                        ? '(stopped)'
                        : describeRecurrence(
                            (recurringSettings.recurringFrequency ?? 'WEEKLY') as RecurringFrequency,
                            recurringSettings.recurringInterval ?? 1,
                            recurringSettings.recurringDaysOfWeek ?? [],
                            recurringSettings.recurringEndDate ? new Date(recurringSettings.recurringEndDate) : null
                          )}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleOpenRecurringDialog}
                >
                  Manage recurrence
                </Button>
              </div>
            </div>
          )}

          {/* Recurring Settings Dialog */}
          <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Manage Recurrence</DialogTitle>
                <DialogDescription>
                  Change frequency, end date, or stop the recurring series.
                </DialogDescription>
              </DialogHeader>
              {loadingRecurring ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                </div>
              ) : recurringSettings ? (
                <div className="space-y-4 pt-2">
                  {recurringSettings.stopped && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                      This recurring series has been stopped. No new instances will be created.
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Frequency */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-700">Frequency</label>
                      <select
                        value={editFrequency}
                        onChange={(e) => setEditFrequency(e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={savingRecurring}
                      >
                        <option value="DAILY">Daily</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                        <option value="YEARLY">Yearly</option>
                      </select>
                    </div>
                    {/* Interval */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-700">Every N periods</label>
                      <input
                        type="number"
                        min={1}
                        value={editInterval}
                        onChange={(e) => setEditInterval(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={savingRecurring}
                      />
                    </div>
                    {/* Days of week — shown only for weekly frequency */}
                    {editFrequency === 'WEEKLY' && (
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-xs font-medium text-gray-700">Days of week</label>
                        <div className="flex flex-wrap gap-1">
                          {(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((label, idx) => {
                            const active = editDaysOfWeek.includes(idx)
                            return (
                              <button
                                key={idx}
                                type="button"
                                disabled={savingRecurring}
                                onClick={() =>
                                  setEditDaysOfWeek(prev =>
                                    active ? prev.filter(d => d !== idx) : [...prev, idx].sort((a, b) => a - b)
                                  )
                                }
                                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                                  active
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                } disabled:opacity-50`}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {/* End date — full width */}
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-medium text-gray-700">End date (leave blank for no end)</label>
                      <input
                        type="date"
                        value={editEndDate}
                        onChange={(e) => setEditEndDate(e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={savingRecurring}
                      />
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div className="flex flex-col gap-2 pt-2">
                    <Button
                      className="w-full"
                      onClick={handleSaveRecurring}
                      disabled={savingRecurring}
                    >
                      {savingRecurring ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                          Saving...
                        </>
                      ) : (
                        'Save changes'
                      )}
                    </Button>
                    {!recurringSettings.stopped && (
                      <Button
                        variant="destructive"
                        className="w-full"
                        onClick={handleStopRecurring}
                        disabled={savingRecurring}
                      >
                        Stop recurring
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() => setRecurringDialogOpen(false)}
                      disabled={savingRecurring}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-gray-500">
                  Could not load recurrence settings.
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* People Involved */}
          <div className="space-y-3">
            <h4 className="font-medium text-gray-900">People</h4>
            
            <div className="space-y-2">
              {/* Creator */}
              {task.creator && (
                <div className="flex items-center gap-2 text-sm">
                  <UserAvatar
                    userId={task.creator.id}
                    image={task.creator.image}
                    name={task.creator.name}
                    email={task.creator.email}
                    className="h-6 w-6"
                    fallbackClassName="text-xs"
                  />
                  <span className="text-gray-600">Creator:</span>
                  <span className="font-medium">{task.creator.name || task.creator.email}</span>
                </div>
              )}

              {/* Assigned to — unified flat list (de-duped union of the
                  TaskAssignee records + dual-written legacy assignee/team/collab) */}
              {(() => {
                const map = new Map<string, { id: string; name?: string; email: string; image?: string }>()
                task.assignees?.forEach((a) => { if (a.user) map.set(a.user.id, a.user) })
                if (task.assignee) map.set(task.assignee.id, task.assignee)
                task.teamMembers?.forEach((m) => { if (m.user) map.set(m.user.id, m.user) })
                task.collaborators?.forEach((c) => { if (c.user) map.set(c.user.id, c.user) })
                const people = Array.from(map.values())
                if (people.length === 0) return null
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">
                        Assigned to{people.length > 1 ? ` (${people.length})` : ''}:
                      </span>
                    </div>
                    <div className="ml-6 space-y-1">
                      {people.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-sm">
                          <UserAvatar
                            userId={p.id}
                            image={p.image}
                            name={p.name}
                            email={p.email}
                            className="h-5 w-5"
                            fallbackClassName="text-xs"
                          />
                          <span className="font-medium">{p.name || p.email}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Custom fields */}
              {task.fieldValues && task.fieldValues.filter(fv => fv.value).length > 0 && (
                <div className="space-y-1.5 pt-1 border-t mt-1">
                  {task.fieldValues
                    .slice()
                    .sort((a, b) => (a.field?.position ?? 0) - (b.field?.position ?? 0))
                    .filter(fv => fv.value)
                    .map(fv => (
                      <div key={fv.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-600">{fv.field?.name || 'Field'}</span>
                        <span className="font-medium text-gray-900 truncate text-right">
                          {fv.field?.type === 'DATE' && fv.value ? new Date(fv.value).toLocaleDateString() : fv.value}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Subtasks Section - Available on all tasks including subtasks */}
          {(
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-gray-900 flex items-center gap-2">
                  <ListTodo className="h-4 w-4" />
                  Subtasks ({localSubtasks?.length || 0})
                </h4>
                {canAddSubtasks && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddSubtask(true)}
                    className="h-7"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Subtask
                  </Button>
                )}
              </div>

              {/* Add Subtask Form */}
              {showAddSubtask && (
                <div className="p-3 bg-gray-50 rounded-lg space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Enter subtask title..."
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleAddSubtask()
                        }
                        if (e.key === 'Escape') {
                          setShowAddSubtask(false)
                          setNewSubtaskTitle('')
                          setNewSubtaskAssigneeId('')
                        }
                      }}
                      maxLength={100}
                      className="flex-1"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex-1">
                      <Select
                        value={newSubtaskAssigneeId}
                        onValueChange={setNewSubtaskAssigneeId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Assign to..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={session?.user?.id || ''}>
                            <div className="flex items-center gap-2">
                              <span>Myself</span>
                            </div>
                          </SelectItem>
                          {availableUsers
                            .filter(u => u.id !== session?.user?.id)
                            .map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                <div className="flex items-center gap-2">
                                  <span>{user.name || user.email}</span>
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Input
                        type="date"
                        value={newSubtaskDeadline}
                        onChange={(e) => setNewSubtaskDeadline(e.target.value)}
                        placeholder="Deadline"
                        className="w-full"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleAddSubtask}
                      disabled={!newSubtaskTitle.trim() || addingSubtask}
                    >
                      {addingSubtask ? (
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowAddSubtask(false)
                        setNewSubtaskTitle('')
                        setNewSubtaskAssigneeId('')
                        setNewSubtaskDeadline('')
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Subtasks List */}
              {localSubtasks && localSubtasks.length > 0 ? (
                <div className="space-y-2">
                  {localSubtasks.map((subtask) => {
                    const getSubtaskStatusIcon = () => {
                      switch (subtask.status) {
                        case 'COMPLETED':
                          return <CheckCircle2 className="h-4 w-4 text-green-500" />
                        case 'IN_PROGRESS':
                        case 'IN_REVIEW':
                          return <AlertCircle className="h-4 w-4 text-blue-500" />
                        default:
                          return <Circle className="h-4 w-4 text-gray-400" />
                      }
                    }

                    const isCascadeStep = subtask.cascadeOrder != null
                    const isLocked = subtask.isLocked === true

                    return (
                      <div
                        key={subtask.id}
                        className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                          isLocked
                            ? 'bg-slate-50 border border-slate-200 opacity-60'
                            : `bg-gray-50 hover:bg-gray-100 ${onSubtaskClick ? 'cursor-pointer' : ''}`
                        }`}
                        onClick={() => !isLocked && onSubtaskClick?.(subtask.id)}
                      >
                        {/* Step number badge (cascade) or checkable icon */}
                        {isCascadeStep ? (
                          <div className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                            {subtask.cascadeOrder}
                          </div>
                        ) : (
                          <button
                            className="flex-shrink-0 focus:outline-none hover:scale-110 transition-transform"
                            title={
                              canCompleteTask
                                ? (subtask.status === 'COMPLETED' ? 'Mark as incomplete' : 'Mark as complete')
                                : (subtask.status === 'IN_REVIEW' ? 'Withdraw submission' : 'Submit for review')
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggleSubtaskCompletion(subtask)
                            }}
                          >
                            {getSubtaskStatusIcon()}
                          </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium break-words ${
                            subtask.status === 'COMPLETED' ? 'text-gray-500 line-through' : 'text-gray-900'
                          }`}>
                            {subtask.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {!isCascadeStep && (
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  subtask.priority === 'URGENT' ? 'text-red-600 border-red-200' :
                                  subtask.priority === 'HIGH' ? 'text-orange-600 border-orange-200' :
                                  subtask.priority === 'MEDIUM' ? 'text-yellow-600 border-yellow-200' :
                                  'text-green-600 border-green-200'
                                }`}
                              >
                                {subtask.priority}
                              </Badge>
                            )}
                            {subtask.dueDate && (
                              <span className="text-xs text-gray-500">
                                Due {format(new Date(subtask.dueDate), 'MMM dd')}
                              </span>
                            )}
                          </div>
                        </div>
                        {isLocked ? (
                          <Lock className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        ) : (
                          subtask.assignee && (
                            <UserAvatar
                              userId={subtask.assignee.id}
                              image={subtask.assignee.image}
                              name={subtask.assignee.name}
                              email={subtask.assignee.email}
                              className="h-6 w-6"
                              fallbackClassName="text-xs"
                            />
                          )
                        )}
                        {!isLocked && <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                      </div>
                    )
                  })}
                </div>
              ) : (
                !showAddSubtask && (
                  <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-400">
                    <ListTodo className="h-4 w-4 opacity-60" />
                    <span>No subtasks yet</span>
                    {canAddSubtasks && (
                      <button
                        type="button"
                        onClick={() => setShowAddSubtask(true)}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        Add one
                      </button>
                    )}
                  </div>
                )
              )}

              {/* Subtask Progress */}
              {localSubtasks && localSubtasks.length > 0 && (
                <div className="pt-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600">Subtask Progress</span>
                    <span className="font-medium">
                      {localSubtasks.filter(s => s.status === 'COMPLETED').length} / {localSubtasks.length} completed
                    </span>
                  </div>
                  <Progress
                    value={(localSubtasks.filter(s => s.status === 'COMPLETED').length / localSubtasks.length) * 100}
                    className="h-2"
                  />
                </div>
              )}
            </div>
          )}

          {/* Parent Task Link - Show if this is a subtask */}
          {task.parent && (
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ChevronRight className="h-4 w-4 rotate-180" />
                <span>Subtask of:</span>
                <span className="font-medium text-gray-900">{task.parent.title}</span>
              </div>
            </div>
          )}

          {/* Recurring Task Info */}
          {task.recurringParentId && (
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <RefreshCw className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium">Recurring task</span>
                <span className="text-blue-500">·</span>
                <span>Part of a recurring series</span>
              </div>
            </div>
          )}

          {/* Timestamps (Completion Time vs Evaluation Time) */}
          {(task.memberSubmittedAt || task.leaderEvaluatedAt) && (
            <div className="border-t pt-4 space-y-2">
              <h4 className="font-medium text-gray-900 text-sm">Timeline</h4>
              {task.memberSubmittedAt && (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Clock className="h-3.5 w-3.5 text-yellow-500" />
                  <span>Submitted for review:</span>
                  <span className="font-medium">{format(new Date(task.memberSubmittedAt), 'MMM dd, yyyy HH:mm')}</span>
                  {task.assignee && <span className="text-gray-400">by {task.assignee.name || task.assignee.email}</span>}
                </div>
              )}
              {task.leaderEvaluatedAt && (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span>Approved/Completed:</span>
                  <span className="font-medium">{format(new Date(task.leaderEvaluatedAt), 'MMM dd, yyyy HH:mm')}</span>
                </div>
              )}
            </div>
          )}

          {/* Work Quality Rating */}
          {(task.status === 'IN_REVIEW' || task.status === 'COMPLETED') && (canCompleteTask || session?.user?.role === 'LEADER') && (
            <div className="border-t pt-4 space-y-3">
              <h4 className="font-medium text-gray-900 text-sm">Work Quality</h4>
              {(() => {
                const qualities = [
                  { value: 'NONE', label: '1', color: 'bg-gray-400' },
                  { value: 'POOR', label: '2', color: 'bg-red-400' },
                  { value: 'FAIR', label: '3', color: 'bg-yellow-400' },
                  { value: 'GOOD', label: '4', color: 'bg-blue-400' },
                  { value: 'EXCELLENT', label: '5', color: 'bg-green-500' },
                ]
                return (
                  <div className="space-y-3">
                    {/* Leader rating — any leader in the board can rate */}
                    {canRateWork && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">Leader Rating</p>
                        <div className="flex gap-2">
                          {qualities.map(q => (
                            <button
                              key={q.value}
                              disabled={savingQuality}
                              onClick={() => handleSetWorkQuality(q.value, false)}
                              className={`w-10 h-10 rounded-full text-xs font-semibold text-white transition-all border-2 ${task.workQuality === q.value ? 'border-gray-800 scale-110' : 'border-transparent opacity-70 hover:opacity-100'} ${q.color}`}
                              title={q.value}
                            >{q.label}</button>
                          ))}
                        </div>
                        {task.workQuality && <p className="text-xs text-gray-500">Current: <span className="font-medium capitalize">{task.workQuality.toLowerCase()}</span></p>}
                      </div>
                    )}
                    {/* Senior override — for admins and leaders who aren't the
                        primary board rater (avoids showing two rating controls). */}
                    {(session?.user?.role === 'ADMIN' || (session?.user?.role === 'LEADER' && !canRateWork)) && task.workQuality && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">Senior Leader Override</p>
                        <div className="flex gap-2">
                          {qualities.map(q => (
                            <button
                              key={q.value}
                              disabled={savingQuality}
                              onClick={() => handleSetWorkQuality(q.value, true)}
                              className={`w-10 h-10 rounded-full text-xs font-semibold text-white transition-all border-2 ${task.seniorWorkQuality === q.value ? 'border-gray-800 scale-110' : 'border-transparent opacity-70 hover:opacity-100'} ${q.color}`}
                              title={q.value}
                            >{q.label}</button>
                          ))}
                        </div>
                        {task.seniorWorkQuality && <p className="text-xs text-gray-500">Override: <span className="font-medium capitalize">{task.seniorWorkQuality.toLowerCase()}</span></p>}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Dependencies Section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-orange-500" />
                Dependencies ({dependencies.blockedBy.length} blocking this task)
              </h4>
              {canEditDependencies && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDepSearchQuery(depSearchQuery ? '' : ' ')}>
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
              )}
            </div>

            {/* Blocked-by warning */}
            {dependencies.blockedBy.some(d => d.status !== 'COMPLETED') && (
              <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>This task is blocked by incomplete tasks and cannot move to In Progress until they are resolved.</span>
              </div>
            )}

            {/* Search for dependency */}
            {canEditDependencies && (
              <div className="space-y-1">
                <Input
                  placeholder="Search tasks to add as dependency..."
                  value={depSearchQuery}
                  onChange={(e) => { setDepSearchQuery(e.target.value); searchTasksForDependency(e.target.value) }}
                  className="h-7 text-xs"
                />
                {depSearchResults.length > 0 && (
                  <div className="border rounded bg-white shadow-sm max-h-32 overflow-y-auto">
                    {depSearchResults.map(t => (
                      <button key={t.id} onClick={() => handleAddDependency(t.id)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-2">
                        <span className="truncate">{t.title}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${t.status === 'COMPLETED' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{t.status.replace('_', ' ')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Blockers list */}
            {loadingDeps ? (
              <div className="flex justify-center py-2"><div className="animate-spin h-4 w-4 rounded-full border-b-2 border-gray-400" /></div>
            ) : dependencies.blockedBy.length > 0 ? (
              <div className="space-y-1">
                {dependencies.blockedBy.map(dep => (
                  <div key={dep.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-xs">
                    {dep.status === 'COMPLETED' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" /> : <Circle className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                    <span className={`flex-1 truncate ${dep.status === 'COMPLETED' ? 'line-through text-gray-400' : 'text-gray-700'}`}>{dep.title}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${dep.status === 'COMPLETED' ? 'bg-green-50 text-green-700' : dep.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{dep.status.replace('_', ' ')}</span>
                    {canEditDependencies && (
                      <button onClick={() => handleRemoveDependency(dep.id)} className="text-gray-400 hover:text-red-500">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No blocking dependencies</p>
            )}
          </div>

          {/* Attachments Section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 flex items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 text-blue-500" />
                Attachments ({attachments.length})
              </h4>
              {canEditDependencies && (
                <>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleAddAttachmentFiles(e.target.files)}
                  />
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={uploadingAttachment} onClick={() => attachmentInputRef.current?.click()}>
                    {uploadingAttachment ? <div className="animate-spin h-3 w-3 rounded-full border-b-2 border-gray-400 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                    Add
                  </Button>
                </>
              )}
            </div>

            {loadingAttachments ? (
              <div className="flex justify-center py-2"><div className="animate-spin h-4 w-4 rounded-full border-b-2 border-gray-400" /></div>
            ) : attachments.length > 0 ? (
              <div className="space-y-1">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-xs group">
                    <span className="shrink-0">{getFileIcon(a.fileType || undefined)}</span>
                    <a href={a.fileUrl} target="_blank" rel="noreferrer" className="flex-1 truncate text-blue-600 hover:underline" title={a.fileName}>{a.fileName}</a>
                    {a.fileSize != null && <span className="text-gray-400 shrink-0">{formatFileSize(a.fileSize ?? undefined)}</span>}
                    <a href={a.fileUrl} target="_blank" rel="noreferrer" download className="text-gray-400 hover:text-gray-700 shrink-0" title="Download"><Download className="h-3.5 w-3.5" /></a>
                    {canEditDependencies && (
                      <button onClick={() => handleRemoveAttachment(a.id)} className="text-gray-300 hover:text-red-500 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" title="Remove">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No attachments</p>
            )}
          </div>

          {/* Deliverables Section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Deliverables ({deliverables.filter(d => d.isCompleted).length}/{deliverables.length})
              </h4>
              {(canCompleteTask || session?.user?.role === 'LEADER') && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAddDeliverable(v => !v)}>
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
              )}
            </div>

            {/* Progress bar */}
            {deliverables.length > 0 && (
              <div>
                <Progress value={deliverables.length > 0 ? (deliverables.filter(d => d.isCompleted).length / deliverables.length) * 100 : 0} className="h-1.5" />
              </div>
            )}

            {/* Add deliverable form */}
            {showAddDeliverable && (
              <div className="flex gap-2">
                <Input
                  placeholder="Deliverable name..."
                  value={newDeliverableName}
                  onChange={(e) => setNewDeliverableName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDeliverable(); if (e.key === 'Escape') setShowAddDeliverable(false) }}
                  className="h-7 text-xs flex-1"
                  autoFocus
                />
                <Button size="sm" className="h-7" onClick={handleAddDeliverable} disabled={!newDeliverableName.trim() || addingDeliverable}>
                  {addingDeliverable ? <div className="animate-spin h-3 w-3 rounded-full border-b-2 border-white" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowAddDeliverable(false)}><X className="h-3 w-3" /></Button>
              </div>
            )}

            {loadingDeliverables ? (
              <div className="flex justify-center py-2"><div className="animate-spin h-4 w-4 rounded-full border-b-2 border-gray-400" /></div>
            ) : deliverables.length > 0 ? (
              <div className="space-y-1">
                {deliverables.map(d => (
                  <div key={d.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-xs group">
                    <button onClick={() => handleToggleDeliverable(d)} className="flex-shrink-0">
                      {d.isCompleted ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-gray-300 hover:text-gray-500" />}
                    </button>
                    <span className={`flex-1 ${d.isCompleted ? 'line-through text-gray-400' : 'text-gray-700'}`}>{d.name}</span>
                    {d.isCompleted && d.submittedBy && <span className="text-gray-400 hidden group-hover:inline">{d.submittedBy.name || d.submittedBy.email}</span>}
                    {(canCompleteTask || session?.user?.role === 'LEADER') && (
                      <button onClick={() => handleDeleteDeliverable(d.id)} className="text-gray-300 hover:text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No deliverables defined</p>
            )}
          </div>

          {/* PR / PO Section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-blue-500" />
                Procurement ({procurements.length})
              </h4>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAddProcurement(v => !v)}>
                <Plus className="h-3 w-3 mr-1" />Add PR/PO
              </Button>
            </div>

            {/* Add form */}
            {showAddProcurement && (
              <div className="p-3 bg-gray-50 rounded space-y-2 text-xs">
                <div className="flex gap-2">
                  <button onClick={() => setNewProcurement(p => ({ ...p, type: 'PURCHASE_REQUEST' }))}
                    className={`flex-1 py-1 rounded border text-center font-medium ${newProcurement.type === 'PURCHASE_REQUEST' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    Purchase Request (PR)
                  </button>
                  <button onClick={() => setNewProcurement(p => ({ ...p, type: 'PURCHASE_ORDER' }))}
                    className={`flex-1 py-1 rounded border text-center font-medium ${newProcurement.type === 'PURCHASE_ORDER' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    Purchase Order (PO)
                  </button>
                </div>
                {/* File picker */}
                <div
                  className="flex items-center gap-2 p-2 border border-dashed border-gray-300 rounded bg-white cursor-pointer hover:bg-gray-50"
                  onClick={() => procurementFileRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-500 truncate">
                    {newProcurement.file ? newProcurement.file.name : 'Click to attach a file (PDF, DOCX, XLSX…)'}
                  </span>
                  {newProcurement.file && (
                    <button
                      className="ml-auto text-gray-400 hover:text-red-500"
                      onClick={e => { e.stopPropagation(); setNewProcurement(p => ({ ...p, file: null })); if (procurementFileRef.current) procurementFileRef.current.value = '' }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <input
                  ref={procurementFileRef}
                  type="file"
                  className="hidden"
                  onChange={e => setNewProcurement(p => ({ ...p, file: e.target.files?.[0] ?? null }))}
                />
                <Input placeholder="Notes (optional)" value={newProcurement.notes} onChange={e => setNewProcurement(p => ({ ...p, notes: e.target.value }))} className="h-7 text-xs" />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAddProcurement(false); setNewProcurement({ type: 'PURCHASE_REQUEST', notes: '', file: null }); if (procurementFileRef.current) procurementFileRef.current.value = '' }}>Cancel</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleAddProcurement} disabled={addingProcurement}>
                    {addingProcurement ? 'Uploading...' : 'Attach'}
                  </Button>
                </div>
              </div>
            )}

            {loadingProcurement ? (
              <div className="flex justify-center py-2"><div className="animate-spin h-4 w-4 rounded-full border-b-2 border-gray-400" /></div>
            ) : procurements.length > 0 ? (
              <div className="space-y-2">
                {procurements.map(p => (
                  <div key={p.id} className="p-3 bg-gray-50 rounded border text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2 py-0.5 rounded font-semibold ${p.type === 'PURCHASE_REQUEST' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {p.type === 'PURCHASE_REQUEST' ? 'PR' : 'PO'}
                      </span>
                      <span className="flex-1" />
                      {(session?.user?.role === 'ADMIN' || session?.user?.role === 'LEADER') && (
                        <select
                          value={p.status}
                          onChange={(e) => handleUpdateProcurementStatus(p.id, e.target.value as Procurement['status'])}
                          className={`text-xs rounded px-1.5 py-0.5 border font-medium ${p.status === 'APPROVED' || p.status === 'PROCESSED' ? 'bg-green-50 text-green-700 border-green-200' : p.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}
                        >
                          <option value="PENDING">Pending</option>
                          <option value="APPROVED">Approved</option>
                          <option value="REJECTED">Rejected</option>
                          <option value="PROCESSED">Processed</option>
                        </select>
                      )}
                    </div>
                    {p.fileUrl ? (
                      <a
                        href={p.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2 bg-white border rounded hover:bg-blue-50 transition-colors"
                      >
                        <File className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <span className="flex-1 truncate text-gray-700 font-medium">{p.fileName || 'Attachment'}</span>
                        {p.fileSize && (
                          <span className="text-gray-400 flex-shrink-0">
                            {p.fileSize < 1024 * 1024
                              ? `${Math.round(p.fileSize / 1024)} KB`
                              : `${(p.fileSize / 1024 / 1024).toFixed(1)} MB`}
                          </span>
                        )}
                        <Download className="h-3 w-3 text-gray-400 flex-shrink-0" />
                      </a>
                    ) : (
                      <p className="text-gray-400 italic">No file attached</p>
                    )}
                    {p.notes && <p className="text-gray-500 italic">{p.notes}</p>}
                    <p className="text-gray-400">By {p.createdBy.name || p.createdBy.email} · {format(new Date(p.createdAt), 'MMM dd, yyyy')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No procurement records</p>
            )}
          </div>

          {/* Enhanced Comments Section */}
          <div className="border-t pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Comments ({comments.length})
              </h4>
            </div>

            {/* Add Comment with Mentions and File Attachments */}
            <div className="space-y-3 relative">
              <div className="relative">
                {/* Highlight backdrop — mirrors the textarea so @mentions glow
                    live while typing. Must match the textarea's box exactly. */}
                <div
                  ref={commentBackdropRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent px-3 py-2 pr-10 text-sm leading-5 text-gray-900"
                >
                  {splitMentions(newComment, mentionNames).map((seg, i) =>
                    seg.isMention ? (
                      <span key={i} className="rounded bg-blue-100 font-semibold text-blue-700">
                        {seg.value}
                      </span>
                    ) : (
                      <span key={i}>{seg.value}</span>
                    )
                  )}
                  {/* keeps the backdrop's height in step with a trailing newline */}
                  {'​'}
                </div>
                <Textarea
                  ref={commentInputRef}
                  placeholder="Write a comment... Use @ to mention someone"
                  value={newComment}
                  maxLength={COMMENT_MAX}
                  onChange={(e) => handleCommentChange(e.target.value)}
                  onScroll={() => {
                    if (commentBackdropRef.current && commentInputRef.current) {
                      commentBackdropRef.current.scrollTop = commentInputRef.current.scrollTop
                    }
                  }}
                  className="relative z-[1] min-h-[80px] max-h-[40vh] resize-none bg-transparent pr-10 leading-5 text-transparent caret-gray-900 selection:bg-blue-200/50 selection:text-transparent"
                />

                {/* Mention Dropdown */}
                {showMentions && mentionUsers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                    {mentionUsers.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleMentionSelect(user)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <UserAvatar
                          userId={user.id}
                          image={user.image}
                          name={user.name}
                          email={user.email}
                          className="h-6 w-6"
                          fallbackClassName="text-xs"
                        />
                        <div>
                          <div className="font-medium text-sm">{user.name}</div>
                          <div className="text-xs text-gray-500">{user.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Pending File Preview */}
              {pendingFile && (
                <div className="relative inline-block">
                  {isImageFile(pendingFile.fileType) ? (
                    <img
                      src={pendingFile.fileUrl}
                      alt="Pending attachment"
                      className="max-w-xs rounded-lg border"
                    />
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border">
                      {getFileIcon(pendingFile.fileType)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pendingFile.fileName}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(pendingFile.fileSize)}</p>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setPendingFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                    title="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        const uploadedFile = await handleFileUpload(file)
                        if (uploadedFile) {
                          setPendingFile({ file, ...uploadedFile })
                        }
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile || !!pendingFile}
                    className="text-gray-500"
                  >
                    {uploadingFile ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-500 mr-1" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Paperclip className="h-4 w-4 mr-1" />
                        Attach
                      </>
                    )}
                  </Button>
                </div>

                <CharCount value={newComment} />
                <Button
                  onClick={() => handleAddComment()}
                  disabled={(!newComment.trim() && !pendingFile) || submittingComment}
                  size="sm"
                >
                  {submittingComment ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                      Posting...
                    </>
                  ) : (
                    <>
                      <Send className="h-3 w-3 mr-2" />
                      Post
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Comments List with Reactions and Replies */}
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {loadingComments ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
                </div>
              ) : comments.length > 0 ? (
                comments.map((comment) => renderComment(comment))
              ) : (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-400">
                  <MessageSquare className="h-4 w-4 opacity-60" />
                  <span>No comments yet</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}