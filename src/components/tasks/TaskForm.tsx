'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { CalendarIcon, Plus, X, Users, User, Handshake, ListTodo, Trash2, ChevronDown, Settings2, RefreshCw, Loader2, GitBranch, GripVertical, Paperclip, FileText } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import { TimePicker } from '@/components/ui/time-picker'
import { SearchableMultiSelect, SelectOption } from '@/components/ui/searchable-multi-select'
import '@/styles/calendar.css'
import '@/styles/popover-fix.css'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { splitDuplicatedChildren } from '@/lib/duplicate-prefill'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { generateOccurrenceDates } from '@/lib/recurring'
import { useToast } from '@/hooks/use-toast'

// Types
type TaskType = 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION' | 'CASCADING'
type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

interface User {
  id: string
  name?: string
  email: string
  image?: string
  role?: string
}

interface PendingSubtask {
  id: string // Temporary ID for UI
  title: string
  assigneeId: string
  assignee?: User
  dueDate?: string
}

interface CascadeStep {
  id: string // Temporary ID for UI
  title: string
  assigneeId: string
  assignee?: User
  dueDate?: string
}

interface AttachmentItem {
  id?: string              // present once persisted to the DB (edit mode)
  tempId?: string          // local key while uploading / before persist
  fileUrl: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
  uploading?: boolean      // transient: shown with a spinner
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}



const recurringFrequencyEnum = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])

const taskFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title too long'),
  description: z.string().optional(),
  dueDate: z.date({ required_error: 'Deadline is required' }),
  startDate: z.date().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  progressPercentage: z.number().min(0).max(100),
  taskType: z.enum(['INDIVIDUAL', 'TEAM', 'COLLABORATION', 'CASCADING']),
  assigneeId: z.string().nullish(), // Always current user
  teamMemberIds: z.array(z.string()).default([]),
  collaboratorIds: z.array(z.string()).default([]),
  assignedById: z.string().optional(),
  // New Google Calendar-compatible fields
  location: z.string().optional(),
  meetingLink: z.string().url().optional().or(z.literal('')),
  allDay: z.boolean().default(true),
  recurrence: z.string().optional(),
  // Time fields for non-all-day events
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  // Subtasks
  subtasks: z.array(z.object({
    title: z.string().min(1).max(100, 'Subtask title must not exceed 100 characters'),
    assigneeId: z.string(),
    dueDate: z.string().optional(),
  })).optional(),
  // Recurring task fields
  isRecurring: z.boolean().default(false),
  recurringFrequency: recurringFrequencyEnum.optional(),
  recurringInterval: z.number().int().min(1).max(30).optional(),
  recurringDaysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  recurringEndDate: z.date().optional().nullable(),
  // Weight, SLA, and reminder fields
  taskWeight: z.number().int().min(1).max(5).optional().nullable(),
  slaHours: z.number().int().min(1).optional().nullable(),
  reminderDays: z.array(z.number().int().min(1)).optional().default([]),
})

type TaskFormData = z.infer<typeof taskFormSchema>

interface TaskFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: any // Existing task for editing
  duplicateFrom?: any // Source task to duplicate (creates a new task pre-filled from this)
  onSubmit: (data: TaskFormData) => Promise<void>
  preSelectedMemberId?: string // Pre-selected team member for assignment
  initialDueDate?: Date // Pre-fill the due date when creating a new task
  boardContext?: { boardId: string; boardName: string; teamId: string | null } | null // active board the task will be created on
  boardFields?: Array<{ id: string; name: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'; options: string[]; required: boolean; position: number }> // active board's custom fields
  initialStatus?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' // preset status (per-column quick-add)
  initialCustomStatusId?: string // the custom board column to drop the new task into (per-column quick-add) (#26)
}

export default function TaskForm({ open, onOpenChange, task, duplicateFrom, onSubmit, preSelectedMemberId, initialDueDate, boardContext, boardFields, initialStatus, initialCustomStatusId }: TaskFormProps) {
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<User[]>([])
  const [selectedCollaborators, setSelectedCollaborators] = useState<User[]>([])
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false)
  const [showAllUsers, setShowAllUsers] = useState(false)

  // Subtask state
  const [pendingSubtasks, setPendingSubtasks] = useState<PendingSubtask[]>([])
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [newSubtaskAssigneeId, setNewSubtaskAssigneeId] = useState('')
  const [newSubtaskDeadline, setNewSubtaskDeadline] = useState('')
  const [recurringNoEndDate, setRecurringNoEndDate] = useState(false)

  // Cascade steps state
  const [cascadeSteps, setCascadeSteps] = useState<CascadeStep[]>([])
  // Optional manual ticket number. Blank => the server allocates the next one.
  const [manualTicket, setManualTicket] = useState('')
  // Board roles a task can be addressed to. Only meaningful on a board.
  const [boardRoles, setBoardRoles] = useState<Array<{ id: string; name: string; color: string; assignments: any[] }>>([])
  const [assignedRoleId, setAssignedRoleId] = useState('')

  // Per-board custom field values (fieldId -> value)
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({})
  const fields = boardFields || []
  const [newStepTitle, setNewStepTitle] = useState('')
  const [newStepAssigneeId, setNewStepAssigneeId] = useState('')
  const [newStepDueDate, setNewStepDueDate] = useState('')
  // Cascading is now a toggle (like Recurring), not a task type. The flat
  // "Assigned To" list is stored in teamMemberIds / selectedTeamMembers.
  const [isCascadingTask, setIsCascadingTask] = useState(false)

  // Attachments. While creating, files are held locally and sent in the submit
  // payload. While editing (task already exists), add/remove hit the dedicated
  // /api/tasks/[id]/attachments endpoint immediately so the change is durable.
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  const { toast } = useToast()

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: '',
      description: '',
      status: 'TODO',
      priority: 'MEDIUM',
      progressPercentage: 0,
      taskType: 'INDIVIDUAL',
      assigneeId: session?.user?.id || null, // Always current user
      teamMemberIds: [],
      collaboratorIds: [],
      assignedById: session?.user?.id,
      // New Google Calendar fields
      location: '',
      meetingLink: '',
      allDay: true,
      recurrence: '',
      startDate: undefined,
      startTime: '',
      endTime: '',
      // Recurring task fields
      isRecurring: false,
      recurringFrequency: undefined,
      recurringInterval: 1,
      recurringDaysOfWeek: [],
      recurringEndDate: null,
      // Weight, SLA, reminder
      taskWeight: null,
      slaHours: null,
      reminderDays: [],
    },
  })

  const taskType = form.watch('taskType')
  const progressPercentage = form.watch('progressPercentage')

  // Track previous open state to only initialize once per open
  const prevOpenRef = useRef(false)

  // Fetch users when dialog opens, or when the team-scope toggle changes
  useEffect(() => {
    if (open) {
      fetchUsers()
    }
  }, [open, showAllUsers, boardContext?.teamId])

  // Board roles, for the "Assign to role" picker. Only boards have roles, so
  // this is skipped entirely for a board-less task.
  useEffect(() => {
    if (!open || !boardContext?.boardId) { setBoardRoles([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/boards/${boardContext.boardId}/roles`)
        if (res.ok && !cancelled) setBoardRoles((await res.json()).roles || [])
      } catch { /* a missing role list should never block task creation */ }

      // Board task template. Applied ONLY when creating — editing an existing
      // task must never have its content quietly replaced by a default. Every
      // value stays editable; these are defaults, not constraints.
      if (task || duplicateFrom) return
      try {
        const res = await fetch(`/api/boards/${boardContext.boardId}/template`)
        if (!res.ok || cancelled) return
        const tpl = (await res.json()).template
        if (!tpl || cancelled) return

        if (tpl.titlePrefix && !form.getValues('title')) form.setValue('title', tpl.titlePrefix)
        if (tpl.description && !form.getValues('description')) form.setValue('description', tpl.description)
        if (tpl.priority) form.setValue('priority', tpl.priority)
        if (tpl.taskWeight) form.setValue('taskWeight', tpl.taskWeight)
        if (tpl.slaHours) form.setValue('slaHours', tpl.slaHours)
        if (tpl.defaultRoleId) setAssignedRoleId(tpl.defaultRoleId)
        if (Array.isArray(tpl.checklist) && tpl.checklist.length > 0) {
          setPendingSubtasks(tpl.checklist.map((c: any, i: number) => ({
            id: `tpl-${i}`, title: String(c.title), assigneeId: '', dueDate: undefined,
          })))
        }
      } catch { /* a missing template should never block task creation */ }
    })()
    return () => { cancelled = true }
  }, [open, boardContext?.boardId, task, duplicateFrom])

  // Initialize form when dialog opens - ONLY ONCE per open (when transitioning from closed to open)
  useEffect(() => {
    // Only initialize when dialog transitions from closed to open
    if (open && !prevOpenRef.current) {
      if (task) {
        // Populate form with existing task data
        const startDateTime = task.startDate ? new Date(task.startDate) : undefined
        const dueDateTime = task.dueDate ? new Date(task.dueDate) : undefined

        form.reset({
          title: task.title,
          description: task.description || '',
          dueDate: dueDateTime,
          startDate: startDateTime,
          status: task.status,
          priority: task.priority,
          progressPercentage: task.progressPercentage || 0,
          taskType: task.taskType,
          assigneeId: task.assigneeId || session?.user?.id, // PRESERVE original assignee when editing
          // Flat Assigned To = union of the old assignee + team members + collaborators
          teamMemberIds: Array.from(new Set([
            task.assigneeId,
            ...(task.teamMembers?.map((tm: any) => tm.userId) || []),
            ...(task.collaborators?.map((c: any) => c.userId) || []),
          ].filter(Boolean) as string[])),
          collaboratorIds: [],
          assignedById: task.assignedById || session?.user?.id,
          // New Google Calendar fields
          location: task.location || '',
          meetingLink: task.meetingLink || '',
          allDay: task.allDay !== undefined ? task.allDay : true,
          recurrence: task.recurrence || '',
          // Extract time from DateTime if not all-day
          startTime: startDateTime && !task.allDay ? startDateTime.toTimeString().slice(0, 5) : '',
          endTime: dueDateTime && !task.allDay ? dueDateTime.toTimeString().slice(0, 5) : '',
          // Recurring task fields (not editable from edit form)
          isRecurring: false,
          recurringFrequency: undefined,
          recurringInterval: 1,
          recurringDaysOfWeek: [],
          recurringEndDate: null,
        })

        // Flat Assigned To display = union of assignee + team members + collaborators
        const memberUsers = new Map<string, any>()
        if ((task as any).assignee) memberUsers.set((task as any).assignee.id, (task as any).assignee)
        task.teamMembers?.forEach((tm: any) => { if (tm.user) memberUsers.set(tm.user.id, tm.user) })
        task.collaborators?.forEach((c: any) => { if (c.user) memberUsers.set(c.user.id, c.user) })
        setSelectedTeamMembers(Array.from(memberUsers.values()))
        setSelectedCollaborators([])
        setIsCascadingTask(!!(task as any).isCascading || task.taskType === 'CASCADING')
        setCustomFieldValues(Object.fromEntries((((task as any).fieldValues) || []).map((v: any) => [v.fieldId, v.value])))
        setAttachments(((task as any).attachments || []).map((a: any) => ({
          id: a.id,
          fileUrl: a.fileUrl,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        })))
      } else if (duplicateFrom) {
        // Duplicate mode: pre-fill from source task, reset status/progress, allow recurring
        const srcDue = duplicateFrom.dueDate ? new Date(duplicateFrom.dueDate) : undefined
        const srcStart = duplicateFrom.startDate ? new Date(duplicateFrom.startDate) : undefined

        form.reset({
          title: `Copy of ${duplicateFrom.title}`,
          description: duplicateFrom.description || '',
          dueDate: srcDue,
          startDate: srcStart,
          status: 'TODO',
          priority: duplicateFrom.priority,
          progressPercentage: 0,
          taskType: duplicateFrom.taskType,
          assigneeId: duplicateFrom.assigneeId || session?.user?.id,
          teamMemberIds: Array.from(new Set([
            duplicateFrom.assigneeId,
            ...(duplicateFrom.teamMembers?.map((tm: any) => tm.userId ?? tm.id) || []),
            ...(duplicateFrom.collaborators?.map((c: any) => c.userId ?? c.id) || []),
          ].filter(Boolean) as string[])),
          collaboratorIds: [],
          assignedById: session?.user?.id,
          location: duplicateFrom.location || '',
          meetingLink: duplicateFrom.meetingLink || '',
          allDay: duplicateFrom.allDay !== undefined ? duplicateFrom.allDay : true,
          recurrence: '',
          startTime: srcStart && !duplicateFrom.allDay ? srcStart.toTimeString().slice(0, 5) : '',
          endTime: srcDue && !duplicateFrom.allDay ? srcDue.toTimeString().slice(0, 5) : '',
          // Recurring fields start fresh — user can set a new schedule
          isRecurring: false,
          recurringFrequency: undefined,
          recurringInterval: 1,
          recurringDaysOfWeek: [],
          recurringEndDate: null,
        })

        const dupMemberUsers = new Map<string, any>()
        if ((duplicateFrom as any).assignee) dupMemberUsers.set((duplicateFrom as any).assignee.id, (duplicateFrom as any).assignee)
        duplicateFrom.teamMembers?.forEach((tm: any) => { const u = tm.user ?? tm; if (u?.id) dupMemberUsers.set(u.id, u) })
        duplicateFrom.collaborators?.forEach((c: any) => { const u = c.user ?? c; if (u?.id) dupMemberUsers.set(u.id, u) })
        setSelectedTeamMembers(Array.from(dupMemberUsers.values()))
        setSelectedCollaborators([])
        setIsCascadingTask(!!(duplicateFrom as any).isCascading || duplicateFrom.taskType === 'CASCADING')
        setCustomFieldValues(Object.fromEntries((((duplicateFrom as any).fieldValues) || []).map((v: any) => [v.fieldId, v.value])))
        // Duplicated tasks start with no attachments (copying OSS files is out of scope).
        setAttachments([])
        // Carry over subtasks when duplicating. DuplicateTaskDialog includes the
        // source subtasks when the "Subtasks" option is checked; without loading
        // them they'd be silently dropped on submit.
        //
        // A cascading duplicate has to land in cascadeSteps, not pendingSubtasks:
        // the cascading UI renders from cascadeSteps, so loading them into
        // pendingSubtasks left the form looking empty while submit still created
        // them. Read the toggle from the source here rather than the state set
        // just above — that setState hasn't applied yet in this pass.
        const duplicateIsCascading =
          !!(duplicateFrom as any).isCascading || duplicateFrom.taskType === 'CASCADING'
        const duplicatedChildren = splitDuplicatedChildren(
          duplicateFrom.subtasks as any,
          duplicateIsCascading
        )
        setPendingSubtasks(duplicatedChildren.pendingSubtasks)
        setCascadeSteps(duplicatedChildren.cascadeSteps)
        setNewSubtaskTitle('')
        setManualTicket('')
        setAssignedRoleId('')
        setNewSubtaskAssigneeId('')
        setNewSubtaskDeadline('')
      } else {
        // Reset to the team-scoped people list each time the form opens fresh.
        setShowAllUsers(false)
        // Set defaults for a new task.
        // When a member is pre-selected (the "Assign Task to member" flow from
        // Member Management / Team Overview), create an INDIVIDUAL task assigned
        // directly TO that member — the leader is the assigner, not the assignee.
        // Otherwise default to an INDIVIDUAL task assigned to the current user.
        form.reset({
          title: '',
          description: '',
          status: initialStatus || 'TODO',
          priority: 'MEDIUM',
          progressPercentage: 0,
          taskType: 'INDIVIDUAL',
          assigneeId: preSelectedMemberId || session?.user?.id || null,
          teamMemberIds: [],
          collaboratorIds: [],
          assignedById: session?.user?.id,
          // New Google Calendar fields
          location: '',
          meetingLink: '',
          allDay: true,
          recurrence: '',
          startDate: undefined,
          startTime: '',
          endTime: '',
          dueDate: initialDueDate || undefined,
          // Recurring task fields
          isRecurring: false,
          recurringFrequency: undefined,
          recurringInterval: 1,
          recurringDaysOfWeek: [],
          recurringEndDate: null,
        })

        // Clear selected arrays
        setSelectedTeamMembers([])
        setSelectedCollaborators([])
        setIsCascadingTask(false)
        setCascadeSteps([])
        setCustomFieldValues({})
        setAttachments([])
        // Clear subtasks
        setPendingSubtasks([])
        setNewSubtaskTitle('')
        setNewSubtaskAssigneeId('')
        setNewSubtaskDeadline('')
      }
    }
    // Update the ref to track current open state
    prevOpenRef.current = open
  }, [open, task, duplicateFrom, form, session, preSelectedMemberId])

  // For brand-new tasks: default the assignee to the current user and, if opened
  // via the "assign to member" flow, seed that member into the flat Assigned To
  // list. Task types were removed, so there's no per-type field clearing.
  useEffect(() => {
    if (!task && !duplicateFrom && session?.user?.id && open) {
      form.setValue('assigneeId', session.user.id)
      if (preSelectedMemberId && users.length > 0 && selectedTeamMembers.length === 0) {
        const u = users.find(x => x.id === preSelectedMemberId)
        if (u) {
          setSelectedTeamMembers([u])
          form.setValue('teamMemberIds', [u.id])
        }
      }
    }
    // For EDITING tasks: preserve the original assignees - do NOT override
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, task, duplicateFrom, form, open, preSelectedMemberId, users])

  // In edit mode, load the task's attachments from the dedicated endpoint. The
  // `task` prop usually comes from the list query, which does not include them,
  // so relying on `task.attachments` alone would show an empty list for tasks
  // that actually have files.
  useEffect(() => {
    if (open && task?.id) {
      fetch(`/api/tasks/${task.id}/attachments`)
        .then((r) => (r.ok ? r.json() : { attachments: [] }))
        .then((d) => setAttachments((d.attachments || []).map((a: any) => ({
          id: a.id,
          fileUrl: a.fileUrl,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }))))
        .catch(() => { /* keep whatever the prop-based init set */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id])

  // When recurring is on, auto-populate dueDate from startDate so the
  // user doesn't have to fill in a redundant "Deadline" field.
  const isRecurring = form.watch('isRecurring')
  const watchedStartDate = form.watch('startDate')
  useEffect(() => {
    if (isRecurring) {
      const sd = form.getValues('startDate')
      if (sd) {
        form.setValue('dueDate', sd)
        form.clearErrors('dueDate')
      }
    }
  }, [isRecurring, watchedStartDate])

  // If the leader switches a pre-selected-member task to TEAM, seed that member
  // as a team member. For the default INDIVIDUAL flow the member is the assignee
  // (not a team member), so we deliberately do NOT inject them here.
  useEffect(() => {
    if (open && !task && preSelectedMemberId && taskType === 'TEAM' && users.length > 0 && selectedTeamMembers.length === 0) {
      const preSelectedUser = users.find(u => u.id === preSelectedMemberId)
      if (preSelectedUser) {
        setSelectedTeamMembers([preSelectedUser])
      }
    }
  }, [open, task, preSelectedMemberId, taskType, users.length])

  const fetchUsers = async () => {
    try {
      const teamId = boardContext?.teamId
      if (teamId && !showAllUsers) {
        const response = await fetch(`/api/user/teams/${teamId}/members`)
        if (response.ok) {
          const data = await response.json()
          setUsers((data.members || []).map((m: any) => ({
            id: m.user.id,
            name: m.user.name ?? undefined,
            email: m.user.email,
            image: m.user.image ?? undefined,
            role: m.user.role,
          })))
          return
        }
      }
      const response = await fetch('/api/user/team-members')
      if (response.ok) {
        const data = await response.json()
        setUsers(data.members || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  // Upload a single file to OSS and return its metadata.
  const uploadOneAttachment = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/upload/task-file', { method: 'POST', body: fd })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      throw new Error(e.error || 'Upload failed')
    }
    return res.json() as Promise<{ fileUrl: string; fileName: string; fileType: string; fileSize: number }>
  }

  const handleAttachmentSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    // Reset the input so the same file can be picked again later.
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    for (const file of list) {
      const tempId = `${file.name}-${file.size}-${file.lastModified}-${attachments.length}`
      setAttachments((prev) => [...prev, { tempId, fileUrl: '', fileName: file.name, fileType: file.type, fileSize: file.size, uploading: true }])
      try {
        const meta = await uploadOneAttachment(file)
        // In edit mode the task already exists — persist immediately so the file
        // survives even if the user closes the form without saving other fields.
        let persistedId: string | undefined
        if (task?.id) {
          const res = await fetch(`/api/tasks/${task.id}/attachments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileUrl: meta.fileUrl, fileName: meta.fileName, fileType: meta.fileType, fileSize: meta.fileSize }),
          })
          if (res.ok) persistedId = (await res.json()).attachment?.id
        }
        setAttachments((prev) => prev.map((a) => a.tempId === tempId
          ? { id: persistedId, fileUrl: meta.fileUrl, fileName: meta.fileName, fileType: meta.fileType, fileSize: meta.fileSize }
          : a))
      } catch (err: any) {
        setAttachments((prev) => prev.filter((a) => a.tempId !== tempId))
        toast({ title: 'Attachment failed', description: err.message || 'Could not upload file', variant: 'destructive' })
      }
    }
  }

  const handleRemoveAttachment = async (item: AttachmentItem) => {
    const key = item.tempId ?? item.id
    setAttachments((prev) => prev.filter((a) => (a.tempId ?? a.id) !== key))
    if (task?.id && item.id) {
      try {
        await fetch(`/api/tasks/${task.id}/attachments?attachmentId=${item.id}`, { method: 'DELETE' })
      } catch {
        // Best-effort: the local list is already updated.
      }
    }
  }

  const handleSubmit = async (data: TaskFormData) => {
    setLoading(true)
    try {
      // Combine date and time if not all-day
      const submissionData = { ...data }

      // Attach per-board custom field values
      if (fields.length > 0) {
        ;(submissionData as any).fieldValues = fields.map((f) => ({ fieldId: f.id, value: customFieldValues[f.id] ?? '' }))
      }

      // New task created via a custom-column quick-add: drop it into that column (#26)
      if (!task && initialCustomStatusId) {
        ;(submissionData as any).customStatusId = initialCustomStatusId
      }

      // Map the flat "Assigned To" (teamMemberIds) + Cascading toggle to the
      // legacy taskType fields the API still expects (type selector was removed).
      if (isCascadingTask) {
        submissionData.taskType = 'CASCADING'
      } else {
        const assignees = data.teamMemberIds || []
        if (assignees.length > 1) {
          submissionData.taskType = 'TEAM'
          submissionData.assigneeId = assignees[0]
          submissionData.teamMemberIds = assignees.slice(1)
        } else {
          submissionData.taskType = 'INDIVIDUAL'
          submissionData.assigneeId = assignees[0] ?? session?.user?.id ?? null
          submissionData.teamMemberIds = []
        }
        submissionData.collaboratorIds = []
      }

      if (!data.allDay) {
        // If we have a start date and time, combine them
        if (data.startDate && data.startTime) {
          const [hours, minutes] = data.startTime.split(':')
          const startDateTime = new Date(data.startDate)
          startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
          submissionData.startDate = startDateTime
        } else if (data.startDate) {
          // No time specified, normalize to midnight local time
          const startDateTime = new Date(data.startDate)
          startDateTime.setHours(0, 0, 0, 0)
          submissionData.startDate = startDateTime
        }

        // If we have an end date and time, combine them
        if (data.dueDate && data.endTime) {
          const [hours, minutes] = data.endTime.split(':')
          const dueDateTime = new Date(data.dueDate)
          dueDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
          submissionData.dueDate = dueDateTime
        } else if (data.dueDate) {
          // No time specified, normalize to midnight local time
          const dueDateTime = new Date(data.dueDate)
          dueDateTime.setHours(23, 59, 59, 999)
          submissionData.dueDate = dueDateTime
        }
      } else {
        // For all-day events, normalize to midnight local time to avoid timezone issues
        if (data.startDate) {
          const startDateTime = new Date(data.startDate)
          startDateTime.setHours(0, 0, 0, 0)
          submissionData.startDate = startDateTime
        }
        if (data.dueDate) {
          const dueDateTime = new Date(data.dueDate)
          dueDateTime.setHours(23, 59, 59, 999)
          submissionData.dueDate = dueDateTime
        }
      }

      if (assignedRoleId) (submissionData as any).assignedRoleId = assignedRoleId

      // Only send a manual ticket number when one was typed; otherwise the
      // server allocates.
      if (!task && manualTicket.trim()) {
        ;(submissionData as any).ticketNumber = manualTicket.trim()
      }

      // Include subtasks in submission (only for non-cascading tasks)
      submissionData.subtasks = pendingSubtasks.map(s => ({
        title: s.title,
        assigneeId: s.assigneeId,
      }))

      // Attachments ride in the payload only on CREATE (the task doesn't exist
      // yet). On EDIT they're already persisted live via the dedicated endpoint.
      // Skip any file still uploading.
      if (!task) {
        ;(submissionData as any).attachments = attachments
          .filter(a => a.fileUrl && !a.uploading)
          .map(a => ({ fileUrl: a.fileUrl, fileName: a.fileName, fileType: a.fileType ?? null, fileSize: a.fileSize ?? null }))
      }

      // Include cascade steps when the Cascading toggle is on
      if (isCascadingTask) {
        ;(submissionData as any).cascadeSteps = cascadeSteps.map(s => ({
          title: s.title,
          assigneeId: s.assigneeId || null,
          dueDate: s.dueDate ? new Date(s.dueDate).toISOString() : null,
        }))
      }

      // Strip null/undefined recurring fields when not recurring so they
      // never reach the API validation (recurringEndDate: null fails datetime check)
      if (!submissionData.isRecurring) {
        delete (submissionData as any).recurringFrequency
        delete (submissionData as any).recurringInterval
        delete (submissionData as any).recurringDaysOfWeek
        delete (submissionData as any).recurringEndDate
        delete (submissionData as any).isRecurring
      } else if (submissionData.recurringEndDate === null) {
        delete (submissionData as any).recurringEndDate
      }

      await onSubmit(submissionData)
      setCustomFieldValues({})
      onOpenChange(false)
      form.reset()
      setPendingSubtasks([])
      setCascadeSteps([])
      setIsCascadingTask(false)
      setAttachments([])
    } catch (error) {
      console.error('Error submitting task:', error)
    } finally {
      setLoading(false)
    }
  }

  const addTeamMember = (user: User) => {
    if (!selectedTeamMembers.find(m => m.id === user.id)) {
      setSelectedTeamMembers([...selectedTeamMembers, user])
      form.setValue('teamMemberIds', [...form.getValues('teamMemberIds'), user.id])
    }
  }

  const removeTeamMember = (userId: string) => {
    setSelectedTeamMembers(selectedTeamMembers.filter(m => m.id !== userId))
    form.setValue('teamMemberIds', form.getValues('teamMemberIds').filter(id => id !== userId))
  }

  const addCollaborator = (user: User) => {
    if (!selectedCollaborators.find(c => c.id === user.id)) {
      setSelectedCollaborators([...selectedCollaborators, user])
      form.setValue('collaboratorIds', [...form.getValues('collaboratorIds'), user.id])
    }
  }

  const removeCollaborator = (userId: string) => {
    setSelectedCollaborators(selectedCollaborators.filter(c => c.id !== userId))
    form.setValue('collaboratorIds', form.getValues('collaboratorIds').filter(id => id !== userId))
  }

  // Subtask handlers
  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return

    const assigneeId = newSubtaskAssigneeId || session?.user?.id || ''
    const assignee = users.find(u => u.id === assigneeId) || (session?.user?.id === assigneeId ? {
      id: session.user.id,
      name: session.user.name || undefined,
      email: session.user.email || '',
    } : undefined)

    const newSubtask: PendingSubtask = {
      id: `temp-${Date.now()}`,
      title: newSubtaskTitle.trim(),
      assigneeId,
      assignee,
      dueDate: newSubtaskDeadline || undefined,
    }

    setPendingSubtasks([...pendingSubtasks, newSubtask])
    setNewSubtaskTitle('')
    setNewSubtaskAssigneeId('')
    setNewSubtaskDeadline('')
  }

  const removeSubtask = (id: string) => {
    setPendingSubtasks(pendingSubtasks.filter(s => s.id !== id))
  }

  const addCascadeStep = () => {
    if (!newStepTitle.trim()) return
    const assigneeId = newStepAssigneeId || ''
    const assignee = assigneeId ? users.find(u => u.id === assigneeId) : undefined
    setCascadeSteps([...cascadeSteps, {
      id: `step-${Date.now()}`,
      title: newStepTitle.trim(),
      assigneeId,
      assignee,
      dueDate: newStepDueDate || undefined,
    }])
    setNewStepTitle('')
    setNewStepAssigneeId('')
    setNewStepDueDate('')
  }

  const removeCascadeStep = (id: string) => {
    setCascadeSteps(cascadeSteps.filter(s => s.id !== id))
  }

  // Recurring and Cascading are mutually exclusive behaviors. Selecting one
  // turns off the other (and clears its fields); selecting the active one again
  // returns the task to a plain task.
  const clearRecurringFields = () => {
    form.setValue('recurringFrequency', undefined)
    form.setValue('recurringEndDate', null)
    form.setValue('recurringDaysOfWeek', [])
    setRecurringNoEndDate(false)
    form.setValue('recurringInterval', 1)
  }
  const toggleRecurring = () => {
    const next = !form.watch('isRecurring')
    if (next && isCascadingTask) { setIsCascadingTask(false); setCascadeSteps([]) }
    form.setValue('isRecurring', next)
    if (!next) clearRecurringFields()
  }
  const toggleCascading = () => {
    const next = !isCascadingTask
    if (next && form.watch('isRecurring')) { form.setValue('isRecurring', false); clearRecurringFields() }
    setIsCascadingTask(next)
    if (!next) setCascadeSteps([])
  }

  const getTaskTypeIcon = (type: TaskType) => {
    switch (type) {
      case 'INDIVIDUAL': return <User className="h-4 w-4" />
      case 'TEAM': return <Users className="h-4 w-4" />
      case 'COLLABORATION': return <Handshake className="h-4 w-4" />
      case 'CASCADING': return <GitBranch className="h-4 w-4" />
      default: return <User className="h-4 w-4" />
    }
  }

  const getProgressColor = (percentage: number) => {
    if (percentage < 25) return 'bg-red-500'
    if (percentage < 50) return 'bg-orange-500'
    if (percentage < 75) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const computeEstimatedCount = () => {
    const startDate = form.watch('startDate') ?? form.watch('dueDate')
    const endDate = form.watch('recurringEndDate')
    const frequency = form.watch('recurringFrequency')
    const interval = form.watch('recurringInterval') || 1
    const days = form.watch('recurringDaysOfWeek') || []
    if (!startDate || !endDate || !frequency) return 0
    try {
      return generateOccurrenceDates(startDate as Date, endDate as Date, frequency, interval, days).length
    } catch {
      return 0
    }
  }

  // Intercept dialog close so users with unsaved changes get a chance to bail
  // out instead of silently dropping their work. Only prompts when the form is
  // actually dirty AND we're closing (not opening).
  const handleOpenChange = (next: boolean) => {
    if (!next && open && form.formState.isDirty && !loading) {
      const ok = window.confirm('Discard your unsaved changes?')
      if (!ok) return
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="z-[100] flex flex-col gap-0 p-0 sm:p-0 overflow-hidden w-screen max-w-none h-[100dvh] sm:w-auto sm:max-w-4xl sm:h-auto sm:max-h-[90vh]">
        <DialogHeader className="sticky top-0 z-10 bg-background border-b px-6 pr-14 pt-6 pb-4">
          <DialogTitle>{task ? 'Edit Task' : duplicateFrom ? 'Duplicate Task' : 'Create New Task'}</DialogTitle>
          <DialogDescription>
            {task ? 'Update the task details below.' : duplicateFrom ? 'Review and adjust the duplicated task before saving.' : 'Fill in the details to create a new task.'}
          </DialogDescription>
          {!task && boardContext?.boardName && (
            <p className="text-xs text-muted-foreground mt-1">Creating on: <span className="font-medium text-foreground">{boardContext.boardName}</span></p>
          )}
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">

          {/* Basic Information Section */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Basic Information</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-base">Task Title <span className="text-red-500">*</span></Label>
                <Input
                  id="title"
                  {...form.register('title')}
                  placeholder="Enter a clear, descriptive task title"
                  className="h-11"
                />
                {form.formState.errors.title && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <span>⚠</span> {form.formState.errors.title.message}
                  </p>
                )}
              </div>

              {/* Address the task to a role instead of a person. Showing the
                  holder count matters: a role with none cannot take work, and
                  the server rejects it — better to see that before submitting. */}
              {boardRoles.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="assignedRole" className="text-base">
                    Assign to Role <span className="text-muted-foreground font-normal text-sm">(optional)</span>
                  </Label>
                  <Select value={assignedRoleId || 'none'} onValueChange={(v) => setAssignedRoleId(v === 'none' ? '' : v)}>
                    <SelectTrigger id="assignedRole" className="h-11">
                      <SelectValue placeholder="Assign to a person instead" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Assign to a person instead</SelectItem>
                      {boardRoles.map(r => (
                        <SelectItem key={r.id} value={r.id} disabled={(r.assignments?.length ?? 0) === 0}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                            {r.name}
                            <span className="text-xs text-muted-foreground">
                              {(r.assignments?.length ?? 0) === 0
                                ? '· nobody holds this yet'
                                : `· ${r.assignments.length} ${r.assignments.length === 1 ? 'person' : 'people'}`}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    One holder is assigned straight away. Several leaves it unclaimed for any of them to take.
                  </p>
                </div>
              )}

              {/* Manual ticket number — create only. Editing an existing
                  task's number is supported by the API but has no UI yet; the
                  task view shows and copies the number but does not change it. */}
              {!task && (
                <div className="space-y-2">
                  <Label htmlFor="ticketNumber" className="text-base">
                    Ticket Number <span className="text-muted-foreground font-normal text-sm">(optional)</span>
                  </Label>
                  <Input
                    id="ticketNumber"
                    value={manualTicket}
                    onChange={e => setManualTicket(e.target.value.toUpperCase())}
                    placeholder="Leave blank to assign automatically"
                    maxLength={24}
                    className="h-11 font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Set your own, e.g. <span className="font-mono">OPS-14</span> — useful when importing an id from
                    another system. Must be unique.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="description" className="text-base">Description</Label>
                <Textarea
                  id="description"
                  {...form.register('description')}
                  placeholder="Provide details about this task..."
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Attachments */}
              <div className="space-y-2">
                <Label className="text-base flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  Attachments
                  <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleAttachmentSelect(e.target.files)}
                />
                {attachments.length > 0 && (
                  <div className="space-y-1.5">
                    {attachments.map((a) => (
                      <div key={a.id ?? a.tempId} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                        {a.uploading
                          ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                          : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                        {a.uploading ? (
                          <span className="flex-1 truncate text-muted-foreground">{a.fileName}</span>
                        ) : (
                          <a href={a.fileUrl} target="_blank" rel="noreferrer" className="flex-1 truncate text-blue-600 hover:underline" title={a.fileName}>
                            {a.fileName}
                          </a>
                        )}
                        {a.fileSize != null && <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(a.fileSize)}</span>}
                        {!a.uploading && (
                          <button type="button" onClick={() => handleRemoveAttachment(a)} className="text-muted-foreground hover:text-red-500 shrink-0" title="Remove">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={attachments.some((a) => a.uploading)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add files
                </Button>
                <p className="text-[11px] text-muted-foreground">Up to 20 files, 50MB each.</p>
              </div>

              {/* Priority — always shown, segmented buttons */}
              <div className="space-y-2">
                <Label className="text-base">Priority Level</Label>
                <div className="flex flex-wrap sm:flex-nowrap rounded-lg border divide-x overflow-hidden">
                  {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map(p => {
                    const labels = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' }
                    const activeColors = { LOW: 'bg-green-100 text-green-800', MEDIUM: 'bg-yellow-100 text-yellow-800', HIGH: 'bg-orange-100 text-orange-800', URGENT: 'bg-red-100 text-red-800' }
                    const active = form.watch('priority') === p
                    return (
                      <button key={p} type="button" onClick={() => form.setValue('priority', p as Priority)}
                        className={cn('flex-1 min-w-0 px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-medium transition-colors',
                          active ? activeColors[p] : 'bg-background text-muted-foreground hover:bg-muted')}>
                        {labels[p]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <Separator />

          {/* Status & Schedule Section */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Status &amp; Schedule</h3>
            <div className="space-y-6">
              {/* Status segmented buttons */}
              <div className="space-y-2">
                <Label className="text-base">Task Status</Label>
                <div className="flex flex-wrap sm:flex-nowrap rounded-lg border divide-x overflow-hidden">
                  {(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'] as const).map(s => {
                    const labels = { TODO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', COMPLETED: 'Completed' }
                    const activeColors = { TODO: 'bg-gray-100 text-gray-800', IN_PROGRESS: 'bg-blue-100 text-blue-800', IN_REVIEW: 'bg-purple-100 text-purple-800', COMPLETED: 'bg-green-100 text-green-800' }
                    const active = form.watch('status') === s
                    return (
                      <button key={s} type="button" onClick={() => form.setValue('status', s as TaskStatus)}
                        className={cn('flex-1 min-w-0 px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-medium transition-colors',
                          active ? activeColors[s] : 'bg-background text-muted-foreground hover:bg-muted')}>
                        {labels[s]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Progress — only when editing */}
              {task && (
                <div className="space-y-3">
                  <div className="space-y-3">
                    <div className="flex gap-2 flex-wrap items-center">
                      {[0, 25, 50, 75, 90].map(p => (
                        <button key={p} type="button"
                          onClick={() => form.setValue('progressPercentage', p)}
                          className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                            progressPercentage === p ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50')}>
                          {p}%
                        </button>
                      ))}
                      <Input type="number" min={0} max={99}
                        value={progressPercentage}
                        onChange={e => form.setValue('progressPercentage', Math.min(99, Number(e.target.value)))}
                        className="w-20 h-8 text-xs" />
                    </div>
                    <Progress value={progressPercentage} className={`h-2 ${getProgressColor(progressPercentage)}`} />
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <span>ℹ️</span> Max 99%. Task must be reviewed by Team Leader to reach 100%.
                    </p>
                  </div>
                </div>
              )}

              {/* Date Range */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Date Range</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">All-day</span>
                    <Switch
                      checked={form.watch('allDay')}
                      onCheckedChange={(checked) => form.setValue('allDay', checked)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                  {/* Start Date */}
                  <div className="space-y-3">
                    <Label htmlFor="startDate" className="text-sm font-medium flex items-center gap-2">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {form.watch('isRecurring') ? 'Series Start Date' : 'Start Date'}
                      {form.watch('isRecurring') ? (
                        <span className="text-xs text-orange-600 font-semibold">*Required</span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-normal">(Optional)</span>
                      )}
                    </Label>
                    <div className="space-y-2">
                      <DatePicker
                        date={form.watch('startDate')}
                        onSelect={(date) => {
                          form.setValue('startDate', date)
                          if (form.watch('isRecurring') && date) {
                            form.setValue('dueDate', date)
                            form.clearErrors('dueDate')
                          }
                        }}
                        placeholder={form.watch('isRecurring') ? 'When does the series begin?' : 'Select start date'}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      />
                      {!form.watch('allDay') && (
                        <TimePicker
                          value={form.watch('startTime') || undefined}
                          onChange={(time) => form.setValue('startTime', time || '')}
                          placeholder="Select start time"
                        />
                      )}
                    </div>
                  </div>

                  {/* Due Date — hidden for recurring tasks (auto-set from start date) */}
                  {form.watch('isRecurring') ? (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        First Task Deadline
                      </Label>
                      <div className="h-11 px-3 flex items-center rounded-md border bg-muted/40 text-sm text-muted-foreground">
                        {form.watch('startDate')
                          ? form.watch('startDate')!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Auto-set from Series Start Date'}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        The first task is due on the series start date.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Label htmlFor="dueDate" className="text-sm font-medium flex items-center gap-2">
                        <CalendarIcon className="h-3.5 w-3.5 text-orange-600" />
                        Deadline
                        <span className="text-xs text-orange-600 font-semibold">*Required</span>
                      </Label>
                      <div className="space-y-2">
                        <DatePicker
                          date={form.watch('dueDate')}
                          onSelect={(date) => {
                            form.setValue('dueDate', date)
                            form.clearErrors('dueDate')
                          }}
                          placeholder="Select deadline"
                          disabled={(date) => {
                            const today = new Date(new Date().setHours(0, 0, 0, 0))
                            const startDate = form.watch('startDate')
                            const minDate = startDate && startDate > today ? startDate : today
                            return date < minDate
                          }}
                        />
                        {form.formState.errors.dueDate && (
                          <p className="text-sm text-red-500 font-medium">
                            {form.formState.errors.dueDate.message}
                          </p>
                        )}
                        {!form.watch('allDay') && (
                          <TimePicker
                            value={form.watch('endTime') || undefined}
                            onChange={(time) => form.setValue('endTime', time || '')}
                            placeholder="Select end time"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Date Helper Messages */}
                <div className="flex flex-col gap-3">
                  {form.watch('startDate') && form.watch('dueDate') && (
                    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                        <span className="text-green-600 text-sm">✓</span>
                      </div>
                      <div className="text-sm text-green-700 font-medium">
                        Task will span {Math.ceil((form.watch('dueDate')!.getTime() - form.watch('startDate')!.getTime()) / (1000 * 60 * 60 * 24)) + 1} days
                      </div>
                    </div>
                  )}
                  {form.watch('dueDate') && !form.watch('startDate') && (
                    <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-blue-600 text-sm">💡</span>
                      </div>
                      <div className="text-sm text-blue-700">
                        Add a start date to create a multi-day task that spans across the calendar
                      </div>
                    </div>
                  )}
                  {form.watch('dueDate') && form.watch('dueDate')! < new Date(new Date().setHours(0, 0, 0, 0)) && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                        <span className="text-red-600 text-sm">⚠</span>
                      </div>
                      <div className="text-sm text-red-700 font-medium">
                        Due date is in the past
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Task behavior — Recurring or Cascading (one at a time). New tasks only. */}
              {!task && (
                <div className="space-y-3">
                  {/* Segmented selector */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={toggleRecurring}
                      className={cn('flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors', form.watch('isRecurring') ? 'border-blue-400 bg-blue-50' : 'border-border bg-muted/20 hover:border-blue-200')}
                    >
                      <div className={cn('p-1.5 rounded-full transition-colors shrink-0', form.watch('isRecurring') ? 'bg-blue-100' : 'bg-muted')}>
                        <RefreshCw className={cn('h-4 w-4 transition-colors', form.watch('isRecurring') ? 'text-blue-600' : 'text-muted-foreground')} />
                      </div>
                      <div className="min-w-0">
                        <p className={cn('text-sm font-semibold transition-colors', form.watch('isRecurring') ? 'text-blue-900' : 'text-foreground')}>Recurring</p>
                        <p className="text-xs text-muted-foreground truncate">Repeats on a schedule</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={toggleCascading}
                      className={cn('flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors', isCascadingTask ? 'border-indigo-400 bg-indigo-50' : 'border-border bg-muted/20 hover:border-indigo-200')}
                    >
                      <div className={cn('p-1.5 rounded-full transition-colors shrink-0', isCascadingTask ? 'bg-indigo-100' : 'bg-muted')}>
                        <GitBranch className={cn('h-4 w-4 transition-colors', isCascadingTask ? 'text-indigo-600' : 'text-muted-foreground')} />
                      </div>
                      <div className="min-w-0">
                        <p className={cn('text-sm font-semibold transition-colors', isCascadingTask ? 'text-indigo-900' : 'text-foreground')}>Cascading</p>
                        <p className="text-xs text-muted-foreground truncate">Ordered, unlocking steps</p>
                      </div>
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">Optional — pick one to add a schedule or ordered steps. Click the active one again to turn it off.</p>

                  {/* Recurring fields */}
                  {form.watch('isRecurring') && (
                    <div className="rounded-xl border-2 border-blue-300 bg-blue-50/40 px-4 pb-4 pt-4 space-y-4">
                      {/* Frequency */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">Repeat frequency</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((freq) => {
                            const isSelected = form.watch('recurringFrequency') === freq
                            return (
                              <button
                                key={freq}
                                type="button"
                                onClick={() => {
                                  form.setValue('recurringFrequency', freq)
                                  if (freq !== 'WEEKLY') form.setValue('recurringDaysOfWeek', [])
                                }}
                                className={cn(
                                  'py-2 rounded-lg border text-sm font-medium transition-all',
                                  isSelected
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-700'
                                )}
                              >
                                {freq.charAt(0) + freq.slice(1).toLowerCase()}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Interval */}
                      {form.watch('recurringFrequency') && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-gray-700">Repeat every</Label>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
                              <button
                                type="button"
                                onClick={() => form.setValue('recurringInterval', Math.max(1, (form.watch('recurringInterval') || 1) - 1))}
                                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 text-lg font-bold leading-none"
                              >−</button>
                              <span className="w-8 text-center text-sm font-semibold">{form.watch('recurringInterval') || 1}</span>
                              <button
                                type="button"
                                onClick={() => form.setValue('recurringInterval', Math.min(30, (form.watch('recurringInterval') || 1) + 1))}
                                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 text-lg font-bold leading-none"
                              >+</button>
                            </div>
                            <span className="text-sm text-gray-600">
                              {form.watch('recurringFrequency') === 'DAILY' && ((form.watch('recurringInterval') || 1) === 1 ? 'day' : 'days')}
                              {form.watch('recurringFrequency') === 'WEEKLY' && ((form.watch('recurringInterval') || 1) === 1 ? 'week' : 'weeks')}
                              {form.watch('recurringFrequency') === 'MONTHLY' && ((form.watch('recurringInterval') || 1) === 1 ? 'month' : 'months')}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Days of week — WEEKLY only */}
                      {form.watch('recurringFrequency') === 'WEEKLY' && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-gray-700">On these days</Label>
                          <div className="flex gap-1.5 flex-wrap">
                            {[
                              { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
                              { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 },
                              { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
                              { label: 'Sun', value: 0 },
                            ].map(({ label, value }) => {
                              const days = form.watch('recurringDaysOfWeek') || []
                              const isOn = days.includes(value)
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => {
                                    const current = form.watch('recurringDaysOfWeek') || []
                                    form.setValue('recurringDaysOfWeek', isOn ? current.filter(d => d !== value) : [...current, value])
                                  }}
                                  className={cn(
                                    'w-10 h-10 rounded-full text-xs font-semibold border transition-all',
                                    isOn ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-700'
                                  )}
                                >{label}</button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Series end date */}
                      {form.watch('recurringFrequency') && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium text-gray-700">
                              Series end date {!recurringNoEndDate && <span className="text-xs text-gray-400 font-normal">(optional)</span>}
                            </Label>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-600">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300 w-3.5 h-3.5"
                                checked={recurringNoEndDate}
                                onChange={(e) => {
                                  setRecurringNoEndDate(e.target.checked)
                                  if (e.target.checked) form.setValue('recurringEndDate', null)
                                }}
                              />
                              No end date
                            </label>
                          </div>
                          {!recurringNoEndDate && (
                            <DatePicker
                              date={form.watch('recurringEndDate') || undefined}
                              onSelect={(date) => form.setValue('recurringEndDate', date || null)}
                              placeholder="Select when the series ends (or check No end date)"
                              disabled={(date) => {
                                const start = form.watch('startDate') || form.watch('dueDate')
                                return start ? date <= start : date < new Date(new Date().setHours(0, 0, 0, 0))
                              }}
                            />
                          )}
                        </div>
                      )}

                      {/* Info banner */}
                      {form.watch('recurringFrequency') && (form.watch('recurringEndDate') || recurringNoEndDate) && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border text-sm bg-blue-50 border-blue-200 text-blue-700">
                          <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>
                            {recurringNoEndDate
                              ? 'This series repeats indefinitely. A new task is created each time the current one is completed.'
                              : 'Only the first task is created now. The next task is automatically created each time the current one is completed.'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cascading steps builder */}
                  {isCascadingTask && (
                    <Card className="border-2 border-indigo-200 bg-indigo-50/50">
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-indigo-100 rounded-full">
                            <GitBranch className="h-5 w-5 text-indigo-600" />
                          </div>
                          <div>
                            <CardTitle className="text-base text-indigo-900">Cascading Task</CardTitle>
                            <CardDescription className="text-indigo-700">
                              Steps must be completed in order. Each step unlocks the next one automatically.
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Add step form */}
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Step title..."
                              value={newStepTitle}
                              onChange={(e) => setNewStepTitle(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCascadeStep() } }}
                              maxLength={200}
                              className="flex-1"
                            />
                            <Button type="button" size="sm" onClick={addCascadeStep} disabled={!newStepTitle.trim()}>
                              <Plus className="h-4 w-4 mr-1" /> Add Step
                            </Button>
                          </div>
                          {newStepTitle.trim() && (
                            <div className="flex gap-2 pl-1">
                              <Select value={newStepAssigneeId} onValueChange={setNewStepAssigneeId}>
                                <SelectTrigger className="h-8 text-xs w-[160px]">
                                  <SelectValue placeholder="Assign to..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={session?.user?.id || 'self'}>Myself</SelectItem>
                                  {users.filter(u => u.id !== session?.user?.id).map((user) => (
                                    <SelectItem key={user.id} value={user.id}>
                                      <div className="flex items-center gap-2">
                                        <Avatar className="h-5 w-5"><AvatarFallback className="text-xs">{(user.name || user.email)?.[0]?.toUpperCase()}</AvatarFallback></Avatar>
                                        {user.name || user.email}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <DatePicker
                                date={newStepDueDate ? new Date(newStepDueDate) : undefined}
                                onSelect={d => setNewStepDueDate(d ? format(d, 'yyyy-MM-dd') : '')}
                                placeholder="Due date (optional)"
                              />
                            </div>
                          )}
                        </div>

                        {/* Steps list */}
                        {cascadeSteps.length > 0 ? (
                          <div className="space-y-2">
                            <Label className="text-sm text-indigo-800">
                              {cascadeSteps.length} step{cascadeSteps.length !== 1 ? 's' : ''} — completed in order
                            </Label>
                            <div className="space-y-2">
                              {cascadeSteps.map((step, index) => (
                                <div
                                  key={step.id}
                                  className="flex items-center gap-3 p-3 bg-white rounded-lg border border-indigo-200"
                                >
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <GripVertical className="h-4 w-4 text-indigo-300" />
                                    <div className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                      {index + 1}
                                    </div>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{step.title}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {step.assignee?.name || step.assignee?.email || 'Unassigned'}
                                      {step.dueDate && <span className="ml-2">· Due {new Date(step.dueDate).toLocaleDateString()}</span>}
                                    </p>
                                  </div>
                                  {index > 0 && (
                                    <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-300 flex-shrink-0">
                                      Locked
                                    </Badge>
                                  )}
                                  {index === 0 && (
                                    <Badge className="text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-100 flex-shrink-0">
                                      First
                                    </Badge>
                                  )}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeCascadeStep(step.id)}
                                    className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-4 text-indigo-600">
                            <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No steps added yet</p>
                            <p className="text-xs text-muted-foreground">Add at least 2 steps to create a cascading task</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Optional details divider */}
          <div className="flex items-center gap-3 py-1">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground font-medium px-2">Optional details</span>
            <Separator className="flex-1" />
          </div>

          {/* Assigned To + Cascading (replaces the old task-type cards) */}
          <section>
            {!isCascadingTask && (
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Assigned To</h3>
            )}

            {/* People-scope toggle — only when in a team board context */}
            {!isCascadingTask && boardContext?.teamId && (
              <div className="flex items-center justify-end gap-2 mb-2">
                <span className="text-xs text-muted-foreground">{showAllUsers ? 'Showing all users' : 'Showing team members only'}</span>
                <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setShowAllUsers(v => !v)}>
                  {showAllUsers ? 'Show team only' : 'Show all users'}
                </button>
              </div>
            )}

            {/* Flat "Assigned To" — one or more people (board members / all users) */}
            {!isCascadingTask && (
              <div className="space-y-2 mb-4">
                <SearchableMultiSelect
                  options={users as SelectOption[]}
                  selected={selectedTeamMembers as SelectOption[]}
                  onSelect={(user) => addTeamMember(user as User)}
                  onRemove={removeTeamMember}
                  onClear={() => { setSelectedTeamMembers([]); form.setValue('teamMemberIds', []) }}
                  placeholder="Search and add people..."
                  emptyText="No people available"
                />
                <p className="text-xs text-muted-foreground">Assign to one or more people. Leave empty to assign it to yourself.</p>
              </div>
            )}

            {false && (
              <Card className="border-2 border-green-200 bg-green-50/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-green-100 rounded-full">
                      <Handshake className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <CardTitle className="text-base text-green-900">Collaboration Task</CardTitle>
                      <CardDescription className="text-green-700">
                        You are the primary assignee. Add collaborators to work together.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-base">Collaborators</Label>
                    <SearchableMultiSelect
                      options={users.filter(u => u.id !== session?.user?.id) as SelectOption[]}
                      selected={selectedCollaborators as SelectOption[]}
                      onSelect={(user) => addCollaborator(user as User)}
                      onRemove={removeCollaborator}
                      onClear={() => {
                        setSelectedCollaborators([])
                        form.setValue('collaboratorIds', [])
                      }}
                      placeholder="Search and add collaborators..."
                      emptyText="No collaborators available"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

          </section>

          {/* Per-board custom fields */}
          {fields.length > 0 && !isCascadingTask && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Custom fields</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fields.map((f) => {
                  const val = customFieldValues[f.id] ?? ''
                  const setVal = (v: string) => setCustomFieldValues((prev) => ({ ...prev, [f.id]: v }))
                  return (
                    <div key={f.id} className="space-y-1.5">
                      <Label className="text-sm">{f.name}{f.required && <span className="text-red-500 ml-0.5">*</span>}</Label>
                      {f.type === 'TEXT' && (
                        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder={`Enter ${f.name.toLowerCase()}…`} />
                      )}
                      {f.type === 'NUMBER' && (
                        <Input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" />
                      )}
                      {f.type === 'DATE' && (
                        <DatePicker
                          date={val ? new Date(val) : undefined}
                          onSelect={(d) => setVal(d ? format(d, 'yyyy-MM-dd') : '')}
                          placeholder="Select date"
                        />
                      )}
                      {f.type === 'SELECT' && (
                        <Select value={val || undefined} onValueChange={setVal}>
                          <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Subtasks Section - Collapsible (only for new non-cascading tasks) */}
          {!task && !isCascadingTask && (
            <Collapsible>
              <Card className="border-2 border-amber-200 bg-amber-50/50">
                <CollapsibleTrigger asChild>
                  <CardHeader className="px-4 py-3 cursor-pointer hover:bg-amber-100/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-amber-100 rounded-full shrink-0">
                          <ListTodo className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-semibold text-amber-900">Subtasks</CardTitle>
                          <CardDescription className="text-xs text-amber-700">
                            Break this task into smaller pieces and assign them to team members
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {pendingSubtasks.length > 0 && (
                          <Badge className="bg-amber-500 text-white">
                            {pendingSubtasks.length}
                          </Badge>
                        )}
                        <ChevronDown className="h-4 w-4 text-amber-600 transition-transform duration-200 data-[state=open]:rotate-180" />
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 px-4 pb-4 pt-0">
                    {/* Add Subtask Form — stacked layout */}
                    <div className="space-y-2">
                      {/* Row 1: Title + Add */}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter subtask title..."
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addSubtask()
                            }
                          }}
                          maxLength={100}
                          className="flex-1"
                        />
                        <Button type="button" size="sm" onClick={addSubtask} disabled={!newSubtaskTitle.trim()}>
                          <Plus className="h-4 w-4 mr-1" /> Add
                        </Button>
                      </div>
                      {/* Row 2: optional meta — shown only when title has content */}
                      {newSubtaskTitle.trim() && (
                        <div className="flex gap-2 pl-1">
                          <Select value={newSubtaskAssigneeId} onValueChange={setNewSubtaskAssigneeId}>
                            <SelectTrigger className="h-8 text-xs w-[160px]">
                              <SelectValue placeholder="Assign to..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={session?.user?.id || 'self'}>
                                Myself
                              </SelectItem>
                              {users.filter(u => u.id !== session?.user?.id).map((user) => (
                                <SelectItem key={user.id} value={user.id}>
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-5 w-5"><AvatarFallback className="text-xs">{(user.name || user.email)?.[0]?.toUpperCase()}</AvatarFallback></Avatar>
                                    {user.name || user.email}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <DatePicker
                            date={newSubtaskDeadline ? new Date(newSubtaskDeadline) : undefined}
                            onSelect={d => setNewSubtaskDeadline(d ? format(d, 'yyyy-MM-dd') : '')}
                            placeholder="Due date (optional)"
                          />
                        </div>
                      )}
                    </div>

                    {/* Subtasks List */}
                    {pendingSubtasks.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm text-amber-800">
                          {pendingSubtasks.length} subtask{pendingSubtasks.length !== 1 ? 's' : ''} to create
                        </Label>
                        <div className="space-y-2">
                          {pendingSubtasks.map((subtask) => (
                            <div
                              key={subtask.id}
                              className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200"
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium break-words">{subtask.title}</p>
                                  <p className="text-xs text-muted-foreground break-words">
                                    Assigned to: {subtask.assignee?.name || subtask.assignee?.email || 'You'}
                                    {subtask.dueDate && (
                                      <span className="ml-2">• Due: {new Date(subtask.dueDate).toLocaleDateString()}</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeSubtask(subtask.id)}
                                className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {pendingSubtasks.length === 0 && (
                      <div className="text-center py-4 text-amber-600">
                        <ListTodo className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No subtasks added yet</p>
                        <p className="text-xs text-muted-foreground">
                          Add subtasks above to break down this task
                        </p>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* More options — merged Weight/SLA/Reminders + Location/Meeting Link */}
          <Collapsible open={moreOptionsOpen} onOpenChange={setMoreOptionsOpen}>
            <Card className="border-2">
              <CollapsibleTrigger asChild>
                <CardHeader className="px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-muted rounded-full shrink-0">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold">More options</CardTitle>
                        <CardDescription className="text-xs">Weight, SLA, reminders, location, and calendar settings</CardDescription>
                      </div>
                    </div>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', moreOptionsOpen && 'rotate-180')} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-6 px-4 pb-4 pt-0">
                  {/* Task Weight (1-5 stars) */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Task Weight <span className="text-xs text-muted-foreground font-normal">(1 = low gravity, 5 = critical)</span></Label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map(w => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => form.setValue('taskWeight', form.watch('taskWeight') === w ? null : w)}
                          className={`w-9 h-9 rounded-lg border-2 text-sm font-bold transition-all ${form.watch('taskWeight') && form.watch('taskWeight')! >= w ? 'bg-amber-400 border-amber-500 text-white' : 'border-gray-200 text-gray-400 hover:border-amber-300'}`}
                        >★</button>
                      ))}
                      {form.watch('taskWeight') && <span className="text-sm text-muted-foreground self-center">Weight: {form.watch('taskWeight')}/5</span>}
                    </div>
                  </div>

                  {/* SLA Hours */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">SLA Target</Label>
                    <div className="flex flex-wrap gap-2">
                      {[4, 8, 24, 48, 72, 168].map(h => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => form.setValue('slaHours', form.watch('slaHours') === h ? null : h)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${form.watch('slaHours') === h ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}
                        >
                          {h < 24 ? `${h}h` : h === 168 ? '1 week' : `${h / 24}d`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reminder Days */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Deadline Reminders</Label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 3, 7, 14].map(d => {
                        const selected = (form.watch('reminderDays') || []).includes(d)
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              const current = form.watch('reminderDays') || []
                              form.setValue('reminderDays', selected ? current.filter(x => x !== d) : [...current, d])
                            }}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${selected ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-200 text-gray-600 hover:border-purple-300'}`}
                          >
                            {d === 1 ? '1 day before' : `${d} days before`}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                    {/* Location */}
                    <div className="space-y-3">
                      <Label htmlFor="location" className="text-sm font-medium flex items-center gap-2">
                        <span className="text-base">📍</span>
                        Location
                      </Label>
                      <Input
                        id="location"
                        {...form.register('location')}
                        placeholder="e.g., Conference Room A, Building 5"
                        className="h-11"
                      />
                      <p className="text-xs text-muted-foreground">
                        Physical location or address
                      </p>
                    </div>

                    {/* Meeting Link */}
                    <div className="space-y-3">
                      <Label htmlFor="meetingLink" className="text-sm font-medium flex items-center gap-2">
                        <span className="text-base">🔗</span>
                        Meeting Link
                      </Label>
                      <Input
                        id="meetingLink"
                        {...form.register('meetingLink')}
                        placeholder="https://meet.google.com/..."
                        type="url"
                        className="h-11"
                      />
                      <p className="text-xs text-muted-foreground">
                        Virtual meeting URL (Meet, Zoom, Teams)
                      </p>
                      {form.formState.errors.meetingLink && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <span>⚠</span> Please enter a valid URL
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Editing recurring instance notice */}
          {task && task.recurringParentId && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <RefreshCw className="h-5 w-5 text-blue-600 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold">Recurring task</p>
                <p>Saving changes will update only this task instance. Future instances will be created fresh from the original series settings.</p>
              </div>
            </div>
          )}

          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                task ? 'Update Task' : duplicateFrom ? 'Duplicate Task' : 'Create Task'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
