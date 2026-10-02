'use client'

import { useState } from 'react'
import {
  Copy, Check, FileText, Flag, Calendar, User,
  ListTree, RefreshCw, MapPin, Users, Gauge,
  Clock, Bell
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

interface DuplicateOptions {
  description: boolean
  priority: boolean
  dueDate: boolean
  assignee: boolean
  subtasks: boolean
  recurrence: boolean
  location: boolean
  collaborators: boolean
  taskWeight: boolean
  slaHours: boolean
  reminderDays: boolean
}

const FIELD_OPTIONS: {
  key: keyof DuplicateOptions
  label: string
  description?: string
  icon: React.ElementType
}[] = [
  { key: 'description',   label: 'Description',          description: 'Copy task description',        icon: FileText  },
  { key: 'priority',      label: 'Priority',             description: 'Copy priority level',           icon: Flag      },
  { key: 'dueDate',       label: 'Due Date',             description: 'Copy deadline date',            icon: Calendar  },
  { key: 'assignee',      label: 'Assignee',             description: 'Copy assignment',               icon: User      },
  { key: 'subtasks',      label: 'Subtasks',             description: 'Copy all subtasks',             icon: ListTree  },
  { key: 'recurrence',    label: 'Recurrence',           description: 'Copy recurring schedule',       icon: RefreshCw },
  { key: 'location',      label: 'Location / Meeting',   description: 'Copy location or meeting link', icon: MapPin    },
  { key: 'collaborators', label: 'Collaborators',        description: 'Copy all collaborators',        icon: Users     },
  { key: 'taskWeight',    label: 'Task Weight',          description: 'Copy importance weight (1–5)',  icon: Gauge     },
  { key: 'slaHours',      label: 'SLA Target',           description: 'Copy SLA deadline hours',       icon: Clock     },
  { key: 'reminderDays',  label: 'Reminders',            description: 'Copy reminder schedule',        icon: Bell      },
]

interface DuplicateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceTask: any
  onConfirm: (filteredTask: any) => void
}

export default function DuplicateTaskDialog({ open, onOpenChange, sourceTask, onConfirm }: DuplicateTaskDialogProps) {
  const [options, setOptions] = useState<DuplicateOptions>({
    description: true,
    priority: true,
    dueDate: false,
    assignee: true,
    subtasks: true,
    recurrence: true,
    location: true,
    collaborators: true,
    taskWeight: true,
    slaHours: true,
    reminderDays: true,
  })

  const toggle = (key: keyof DuplicateOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const allSelected = Object.values(options).every(Boolean)
  const toggleAll = () => {
    const next = !allSelected
    setOptions(Object.fromEntries(FIELD_OPTIONS.map(f => [f.key, next])) as unknown as DuplicateOptions)
  }

  const handleConfirm = () => {
    const filtered: any = { title: `${sourceTask.title} (Copy)` }

    if (options.description && sourceTask.description) filtered.description = sourceTask.description
    if (options.priority) filtered.priority = sourceTask.priority
    if (options.dueDate && sourceTask.dueDate) filtered.dueDate = sourceTask.dueDate
    if (options.assignee && sourceTask.assignee) {
      filtered.assigneeId = sourceTask.assignee.id
      filtered.assignee = sourceTask.assignee
    }
    if (options.subtasks && sourceTask.subtasks) filtered.subtasks = sourceTask.subtasks
    if (options.recurrence) {
      if (sourceTask.isRecurring !== undefined) filtered.isRecurring = sourceTask.isRecurring
      if (sourceTask.recurringFrequency) filtered.recurringFrequency = sourceTask.recurringFrequency
      if (sourceTask.recurringInterval) filtered.recurringInterval = sourceTask.recurringInterval
      if (sourceTask.recurringDaysOfWeek) filtered.recurringDaysOfWeek = sourceTask.recurringDaysOfWeek
    }
    if (options.location) {
      if (sourceTask.location) filtered.location = sourceTask.location
      if (sourceTask.meetingLink) filtered.meetingLink = sourceTask.meetingLink
    }
    if (options.collaborators && sourceTask.collaborators) filtered.collaborators = sourceTask.collaborators
    if (options.taskWeight && sourceTask.taskWeight) filtered.taskWeight = sourceTask.taskWeight
    if (options.slaHours && sourceTask.slaHours) filtered.slaHours = sourceTask.slaHours
    if (options.reminderDays && sourceTask.reminderHours?.length) filtered.reminderHours = sourceTask.reminderHours

    filtered.taskType = sourceTask.taskType || 'INDIVIDUAL'
    if (sourceTask.teamMembers) filtered.teamMembers = sourceTask.teamMembers

    onConfirm(filtered)
    onOpenChange(false)
  }

  const selectedCount = Object.values(options).filter(Boolean).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-md bg-blue-50">
              <Copy className="h-4 w-4 text-blue-600" />
            </div>
            Duplicate Task
          </DialogTitle>
          <DialogDescription>
            Choose which fields to copy. Title is always included.
          </DialogDescription>
        </DialogHeader>

        {/* Source task name */}
        {sourceTask && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
            <Copy className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-slate-800 truncate flex-1">{sourceTask.title}</span>
            <span className="text-xs text-slate-400 flex-shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">copy</span>
          </div>
        )}

        {/* Select all / count row */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{selectedCount}</span> of {FIELD_OPTIONS.length} fields selected
          </span>
          <button
            onClick={toggleAll}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        {/* Field options */}
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {FIELD_OPTIONS.map(({ key, label, description, icon: Icon }) => (
            <label
              key={key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors select-none ${
                options[key]
                  ? 'bg-blue-50 border border-blue-100'
                  : 'hover:bg-slate-50 border border-transparent'
              }`}
            >
              {/* Custom checkbox */}
              <div
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  options[key] ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                }`}
              >
                {options[key] && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
              </div>
              <input type="checkbox" className="hidden" checked={options[key]} onChange={() => toggle(key)} />

              {/* Field icon */}
              <div className={`p-1 rounded-md flex-shrink-0 ${options[key] ? 'bg-blue-100' : 'bg-slate-100'}`}>
                <Icon className={`h-3 w-3 ${options[key] ? 'text-blue-600' : 'text-slate-500'}`} />
              </div>

              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${options[key] ? 'text-blue-900' : 'text-slate-700'}`}>
                  {label}
                </span>
                {description && (
                  <p className={`text-xs mt-0.5 ${options[key] ? 'text-blue-500' : 'text-slate-400'}`}>
                    {description}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={selectedCount === 0} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Copy className="h-3.5 w-3.5" />
            Duplicate
            <span className="bg-blue-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
              {selectedCount}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
