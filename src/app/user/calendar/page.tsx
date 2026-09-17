'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Calendar, momentLocalizer, Views } from 'react-big-calendar'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Calendar as CalendarIcon, AlertCircle, Settings, RefreshCw, FileText, Clock, Users, User, Tag, CheckCircle2, AlertTriangle, Flag, X, ChevronRight, Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { EVENT_TYPE_COLORS } from '@/constants'
import CalendarSyncSettingsModal from '@/components/calendar/CalendarSyncSettingsModal'
import CreateTaskButton from '@/components/tasks/CreateTaskButton'
import TaskForm from '@/components/tasks/TaskForm'
import { useCalendarSync } from '@/hooks/useCalendarSync'
import { useToast } from '@/hooks/use-toast'
import '@/styles/react-big-calendar.css'

const localizer = momentLocalizer(moment)

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay?: boolean
  resource?: {
    description?: string
    color?: string
    type: 'MEETING' | 'DEADLINE' | 'REMINDER' | 'MILESTONE' | 'PERSONAL'
    creator?: {
      id: string
      name: string
      email: string
    }
    team?: {
      id: string
      name: string
    }
    task?: {
      id: string
      title: string
      priority: string
      status: string
    }
    subtasks?: NestedSubtask[]
  }
}

interface NestedSubtask {
  id: string
  title: string
  status: string
  assignee?: { id: string; name: string; email: string } | null
  subtasks?: NestedSubtask[]
}

interface TaskDeadline {
  id: string
  title: string
  dueDate: string
  startDate?: string
  allDay?: boolean
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED'
  googleCalendarEventId?: string | null
  creatorId?: string
  parentId?: string | null
  assignee?: {
    id: string
    name: string
    email: string
  }
  creator?: {
    id: string
    name: string
    email: string
  }
  team?: {
    id: string
    name: string
  } | null
  teamMembers?: Array<{
    userId: string
    user: {
      id: string
      name: string
      email: string
    }
  }>
  collaborators?: Array<{
    userId: string
    user: {
      id: string
      name: string
      email: string
    }
  }>
}

export default function CalendarPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false)
  const [isSyncSettingsOpen, setIsSyncSettingsOpen] = useState(false)
  const [togglingSubtaskId, setTogglingSubtaskId] = useState<string | null>(null)
  // Google Calendar sync (on-open + manual model — no webhooks/cron)
  const [syncSettings, setSyncSettings] = useState<any>(null)
  const [isManualSyncing, setIsManualSyncing] = useState(false)
  const autoImportRef = useRef(false)
  // Day sidebar
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [isDaySidebarOpen, setIsDaySidebarOpen] = useState(false)
  const [isNewTaskFormOpen, setIsNewTaskFormOpen] = useState(false)
  const [portalMounted, setPortalMounted] = useState(false)
  useEffect(() => { setPortalMounted(true) }, [])

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const { toast } = useToast()

  const handleToggleSubtask = async (subtaskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'COMPLETED' ? 'TODO' : 'COMPLETED'
    const newProgress = newStatus === 'COMPLETED' ? 100 : 0
    setTogglingSubtaskId(subtaskId)
    // Optimistic UI update in selectedEvent
    setSelectedEvent(prev => {
      if (!prev?.resource?.subtasks) return prev
      return {
        ...prev,
        resource: {
          ...prev.resource,
          subtasks: prev.resource.subtasks.map(s =>
            s.id === subtaskId ? { ...s, status: newStatus } : s
          )
        }
      }
    })
    try {
      const res = await fetch(`/api/tasks/${subtaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, progressPercentage: newProgress })
      })
      if (!res.ok) throw new Error('Failed to update subtask')
    } catch {
      // Revert
      setSelectedEvent(prev => {
        if (!prev?.resource?.subtasks) return prev
        return {
          ...prev,
          resource: {
            ...prev.resource,
            subtasks: prev.resource.subtasks.map(s =>
              s.id === subtaskId ? { ...s, status: currentStatus } : s
            )
          }
        }
      })
      toast({ title: 'Error', description: 'Failed to update subtask', variant: 'destructive' })
    } finally {
      setTogglingSubtaskId(null)
    }
  }

  const fetchCalendarData = useCallback(async () => {
    if (!session?.user) return

    try {
      setLoading(true)

      const [eventsResponse, tasksResponse, syncSettingsResponse, holidaysResponse] = await Promise.all([
        fetch('/api/events'),
        fetch('/api/tasks?status=TODO,IN_PROGRESS,IN_REVIEW'),
        fetch('/api/calendar/sync-settings'),
        fetch('/api/calendar/holidays')
      ])

      if (!eventsResponse.ok || !tasksResponse.ok) {
        throw new Error('Failed to fetch calendar data')
      }

      const [eventsData, tasksData, syncData, holidaysData] = await Promise.all([
        eventsResponse.json(),
        tasksResponse.json(),
        syncSettingsResponse.ok ? syncSettingsResponse.json() : { syncSettings: null },
        holidaysResponse.ok ? holidaysResponse.json() : { holidays: [] }
      ])

      // Keep the latest Google sync settings so the on-open import effect can
      // decide whether a background pull from Google is due.
      setSyncSettings(syncData?.syncSettings ?? null)

      const calendarEvents: CalendarEvent[] = []

      // Add regular TMS events
      if (eventsData.events) {
        eventsData.events.forEach((event: any) => {
          calendarEvents.push({
            id: `event-${event.id}`,
            title: event.title,
            start: new Date(event.startTime),
            end: new Date(event.endTime),
            allDay: event.allDay,
            resource: {
              description: event.description,
              color: EVENT_TYPE_COLORS[event.type as keyof typeof EVENT_TYPE_COLORS] || '#3b82f6',
              type: event.type,
              creator: event.creator,
              team: event.team
            }
          })
        })
      }

      // Add holidays
      if (holidaysData.holidays) {
        holidaysData.holidays.forEach((holiday: any) => {
          calendarEvents.push({
            id: `holiday-${holiday.id}`,
            title: `🎉 ${holiday.title}`,
            start: new Date(holiday.date),
            end: new Date(holiday.date),
            allDay: true,
            resource: {
              description: holiday.description || 'Holiday',
              color: '#9333ea',
              type: 'PERSONAL'
            }
          })
        })
      }

      // Add task deadlines - parent tasks only; subtasks are shown inside the popup
      if (tasksData.tasks) {
        tasksData.tasks.forEach((task: any) => {
          // Skip subtasks — they appear inside the parent task's popup
          if (task.parentId) return
          if (task.dueDate && task.status !== 'COMPLETED') {
            // Check if user is involved in this task in any way:
            // 1. User is the assignee
            // 2. User is a team member (for TEAM tasks)
            // 3. User is a collaborator (for COLLABORATION tasks)
            // 4. User is the creator
            const isAssignee = task.assignee?.id === session?.user?.id
            const isTeamMember = task.teamMembers?.some((tm: any) => tm.userId === session?.user?.id)
            const isCollaborator = task.collaborators?.some((c: any) => c.userId === session?.user?.id)
            const isCreator = task.creator?.id === session?.user?.id || task.creatorId === session?.user?.id

            // Show task if user is involved in any capacity
            if (isAssignee || isTeamMember || isCollaborator || isCreator) {
              const priorityColors = {
                URGENT: '#dc2626',
                HIGH: '#ea580c',
                MEDIUM: '#d97706',
                LOW: '#16a34a'
              }

              // Determine task type label
              let taskTypeLabel = ''
              const isSubtask = !!task.parentId

              if (isSubtask) {
                taskTypeLabel = 'Subtask'
              } else if (isAssignee) {
                taskTypeLabel = 'My Task'
              } else if (isTeamMember) {
                taskTypeLabel = 'Team Task'
              } else if (isCollaborator) {
                taskTypeLabel = 'Collaboration'
              } else if (isCreator) {
                taskTypeLabel = 'Created by Me'
              }

              // CRITICAL: Multi-day event handling
              let startDate: Date
              let endDate: Date

              if (task.startDate && task.dueDate) {
                // Multi-day task
                startDate = new Date(task.startDate)
                endDate = new Date(task.dueDate)
              } else {
                // Single-day task
                startDate = new Date(task.dueDate)
                endDate = new Date(task.dueDate)
              }

              calendarEvents.push({
                id: `task-${task.id}`,
                title: `[${taskTypeLabel}] ${task.title}`,
                start: startDate,
                end: endDate,
                allDay: task.allDay !== undefined ? task.allDay : true,
                resource: {
                  description: `Due: ${task.team?.name || 'Individual'} task`,
                  color: priorityColors[task.priority as keyof typeof priorityColors] || '#3b82f6',
                  type: 'DEADLINE',
                  team: task.team || undefined,
                  task: {
                    id: task.id,
                    title: task.title,
                    priority: task.priority,
                    status: task.status
                  },
                  subtasks: task.subtasks || []
                }
              })
            }
          }
        })
      }

      setEvents(calendarEvents)
    } catch (err) {
      console.error('Error fetching calendar data:', err)
      setError('Failed to load calendar data')
    } finally {
      setLoading(false)
    }
  }, [session])

  // Keep the socket hook for live refresh on task changes; calendar import is
  // now pull-based (on open + manual), so we don't rely on its connection state.
  useCalendarSync(fetchCalendarData)

  useEffect(() => {
    fetchCalendarData()
  }, [fetchCalendarData])

  // On-open import: if Google sync is enabled and the last import is stale,
  // pull changes from Google in the background once per mount, then refresh.
  // Runs after fetchCalendarData has loaded syncSettings into state. The ref
  // guard means the post-import refresh can't retrigger another import.
  useEffect(() => {
    if (!syncSettings?.isEnabled || autoImportRef.current) return
    const last = syncSettings.lastSyncedAt ? new Date(syncSettings.lastSyncedAt).getTime() : 0
    if (Date.now() - last < 3 * 60 * 1000) return // imported recently — skip
    autoImportRef.current = true
    fetch('/api/calendar/sync-from-google', { method: 'POST' })
      .then((r) => { if (r.ok) fetchCalendarData() })
      .catch(() => { /* best-effort: on-open import never blocks the view */ })
  }, [syncSettings, fetchCalendarData])

  // Manual "Sync now": two-way pull + push, then refresh. HTTP-based so it
  // works regardless of the websocket layer.
  const handleSyncNow = useCallback(async () => {
    if (!syncSettings?.isEnabled || isManualSyncing) return
    setIsManualSyncing(true)
    try {
      await Promise.all([
        fetch('/api/calendar/sync-from-google', { method: 'POST' }),
        fetch('/api/calendar/sync-to-google', { method: 'POST' }),
      ])
      await fetchCalendarData()
      toast({ title: 'Calendar synced', description: 'Pulled the latest from Google Calendar.' })
    } catch {
      toast({ title: 'Sync failed', description: 'Could not sync with Google Calendar.', variant: 'destructive' })
    } finally {
      setIsManualSyncing(false)
    }
  }, [syncSettings, isManualSyncing, fetchCalendarData, toast])

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event)
    setIsEventDialogOpen(true)
  }

  const handleSelectSlot = ({ start }: { start: Date }) => {
    setSelectedDate(start)
    setIsDaySidebarOpen(true)
  }

  const handleDrillDown = (date: Date) => {
    setSelectedDate(date)
    setIsDaySidebarOpen(true)
  }

  // Custom date header — clicking the "14" label opens the sidebar
  const DateHeaderComponent = useCallback(({ date, label }: { date: Date; label: string }) => (
    <button
      onClick={(e) => { e.stopPropagation(); handleDrillDown(date) }}
      style={{ width: '100%', textAlign: 'right', padding: '4px 6px', cursor: 'pointer', fontWeight: 'inherit', fontSize: 'inherit', color: 'inherit', background: 'none', border: 'none' }}
    >
      {label}
    </button>
  ), [])

  const daySidebarEvents = useMemo(() => {
    if (!selectedDate) return []
    return events.filter(ev => {
      const evStart = new Date(ev.start)
      const evEnd = new Date(ev.end)
      const day = new Date(selectedDate)
      day.setHours(0, 0, 0, 0)
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999)
      return evStart <= dayEnd && evEnd >= day
    })
  }, [events, selectedDate])

  const handleNewTaskSubmit = async (data: any) => {
    try {
      const { subtasks, ...taskData } = data
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to create task')
      if (subtasks?.length > 0) {
        await Promise.all(subtasks.map((s: any) => fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: s.title, parentId: result.id, priority: taskData.priority, taskType: 'INDIVIDUAL', assigneeId: s.assigneeId, dueDate: s.dueDate ? new Date(s.dueDate).toISOString() : undefined }),
        })))
      }
      toast({ title: 'Task created successfully' })
      setIsNewTaskFormOpen(false)
      fetchCalendarData()
    } catch (err) {
      throw err // TaskForm shows the error and keeps the form open
    }
  }

  // Event style getter - CRITICAL for multi-day events
  const eventStyleGetter = (event: CalendarEvent) => {
    const backgroundColor = event.resource?.color || '#3b82f6'

    return {
      style: {
        backgroundColor,
        borderRadius: '6px',
        opacity: 0.9,
        color: 'white',
        border: '0px',
        display: 'block',
        fontWeight: 600,
        fontSize: '0.875rem',
        padding: '2px 6px'
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  const isLeader = session?.user?.role === 'LEADER'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Calendar</h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <p className="text-sm sm:text-base text-muted-foreground">
              {isLeader
                ? "View your schedule and team deadlines"
                : "View your schedule and task deadlines"
              }
            </p>
            {syncSettings?.isEnabled && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="flex items-center gap-1 bg-green-50 text-green-700 border-green-200">
                  <CalendarIcon className="h-3 w-3" />
                  Google connected
                </Badge>
                {isManualSyncing && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Syncing...
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
          <CreateTaskButton
            onTaskCreated={fetchCalendarData}
            className="text-xs sm:text-sm px-2.5 sm:px-4"
          />
          {syncSettings?.isEnabled && (
            <Button
              variant="outline"
              onClick={handleSyncNow}
              disabled={isManualSyncing}
              className="text-xs sm:text-sm px-2.5 sm:px-4"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 sm:mr-2 ${isManualSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync now</span>
              <span className="sm:hidden truncate">Sync now</span>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setIsSyncSettingsOpen(true)}
            className="text-xs sm:text-sm px-2.5 sm:px-4"
          >
            <Settings className="h-4 w-4 shrink-0 sm:mr-2" />
            <span className="hidden sm:inline">Google Calendar Sync</span>
            <span className="sm:hidden truncate">Settings</span>
          </Button>
        </div>
      </div>

      {/* Legend */}
      <Card>
        <CardHeader className="pb-2 sm:pb-6">
          <CardTitle className="text-base sm:text-lg">Event Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-sm">Meetings</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
              <span className="text-sm">Google Synced</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-600"></div>
              <span className="text-sm">Urgent Deadlines</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-600"></div>
              <span className="text-sm">High Priority</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-600"></div>
              <span className="text-sm">Medium Priority</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-600"></div>
              <span className="text-sm">Low Priority</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-600"></div>
              <span className="text-sm">Holidays</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar — fits the viewport on mobile (responsive CSS handles the
          dense grid); keeps a comfortable min width on sm+ screens. */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <div className="min-w-0 sm:min-w-[620px]">
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 900 }}
            onSelectEvent={handleSelectEvent}
            onSelectSlot={handleSelectSlot}
            onDrillDown={handleDrillDown}
            selectable
            components={{ dateHeader: DateHeaderComponent }}
            eventPropGetter={eventStyleGetter}
            views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
            defaultView={Views.MONTH}
            popup={false}
            showMultiDayTimes
            step={30}
            timeslots={2}
            doShowMoreDrillDown={false}
            onShowMore={(_events: CalendarEvent[], date: Date) => handleDrillDown(date)}
            messages={{
              showMore: (total: number) => `+${total} more`,
              noEventsInRange: 'No events scheduled for this period. Create a task or sync with Google Calendar to see events here.'
            }}
          />
        </div>
      </div>

      {/* Day Sidebar — rendered via portal at document.body to avoid stacking context issues */}
      {portalMounted && createPortal(
        <div
          style={{
            position: 'fixed',
            top: isMobile ? 'auto' : 0,
            bottom: isMobile ? 0 : 'auto',
            right: 0,
            left: isMobile ? 0 : 'auto',
            width: isMobile ? '100%' : 340,
            height: isMobile ? '80vh' : '100vh',
            zIndex: 9999,
            transform: isDaySidebarOpen ? 'translateY(0) translateX(0)' : isMobile ? 'translateY(100%)' : 'translateX(100%)',
            transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: isDaySidebarOpen ? (isMobile ? '0 -12px 40px rgba(0,0,0,0.15)' : '-12px 0 40px rgba(0,0,0,0.15)') : 'none',
            background: '#ffffff',
            borderRadius: isMobile ? '16px 16px 0 0' : 0,
          }}
        >
          {/* Header — clean white, Google-style */}
          <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', flexShrink: 0, padding: '16px 16px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
              <div>
                <p style={{ color: '#64748b', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>
                  {selectedDate ? moment(selectedDate).format('dddd') : ''}
                </p>
                <p style={{ color: '#0f172a', fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', marginBottom: 4 }}>
                  {selectedDate ? moment(selectedDate).format('MMMM D, YYYY') : ''}
                </p>
                <p style={{ color: '#94a3b8', fontSize: 12, fontWeight: 400 }}>
                  {daySidebarEvents.length === 0
                    ? 'No events scheduled'
                    : `${daySidebarEvents.length} event${daySidebarEvents.length !== 1 ? 's' : ''} scheduled`}
                </p>
              </div>
              <button
                onClick={() => setIsDaySidebarOpen(false)}
                style={{ color: '#94a3b8', background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0, marginTop: 2 }}
                onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#f1f5f9'; b.style.color = '#475569' }}
                onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'transparent'; b.style.color = '#94a3b8' }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
            <button
              onClick={() => setIsNewTaskFormOpen(true)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: '#2563eb', color: '#ffffff', border: 'none',
                borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2563eb' }}
            >
              <Plus style={{ width: 14, height: 14 }} />
              Add task
            </button>
          </div>

          {/* Events list */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
            {daySidebarEvents.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 28px', textAlign: 'center' }}>
                <CalendarIcon style={{ width: 32, height: 32, color: '#cbd5e1', marginBottom: 12 }} />
                <p style={{ color: '#475569', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No events</p>
                <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>Nothing scheduled for this day. Add a task to get started.</p>
              </div>
            ) : (
              <div style={{ padding: '8px' }}>
                {daySidebarEvents.map((ev, i) => {
                  const color = ev.resource?.color || '#3b82f6'
                  const isTask = !!ev.resource?.task
                  const priority = ev.resource?.task?.priority
                  const priorityMeta: Record<string, { bg: string; text: string; label: string }> = {
                    URGENT: { bg: '#fef2f2', text: '#dc2626', label: 'Urgent' },
                    HIGH:   { bg: '#fff7ed', text: '#ea580c', label: 'High' },
                    MEDIUM: { bg: '#fffbeb', text: '#d97706', label: 'Medium' },
                    LOW:    { bg: '#f0fdf4', text: '#16a34a', label: 'Low' },
                  }
                  const meta = priority ? priorityMeta[priority] : null
                  return (
                    <button
                      key={ev.id || ev.title}
                      onClick={() => { handleSelectEvent(ev); setIsDaySidebarOpen(false) }}
                      style={{
                        width: '100%', textAlign: 'left', display: 'block',
                        background: '#ffffff', border: '1px solid #e2e8f0',
                        borderLeft: `3px solid ${color}`, borderRadius: 10,
                        padding: '11px 13px', marginBottom: 8, cursor: 'pointer',
                        transition: 'all 0.15s', animationDelay: `${i * 40}ms`,
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLButtonElement
                        el.style.boxShadow = '0 2px 8px rgba(37,99,235,0.1)'
                        el.style.borderColor = '#bfdbfe'
                        el.style.borderLeftColor = color
                        el.style.transform = 'translateX(-2px)'
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLButtonElement
                        el.style.boxShadow = 'none'
                        el.style.borderColor = '#e2e8f0'
                        el.style.borderLeftColor = color
                        el.style.transform = 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ color: '#1e293b', fontSize: 13, fontWeight: 600, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ev.title.replace(/^\[.*?\]\s*/, '')}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            {isTask && meta && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: meta.bg, color: meta.text }}>
                                {meta.label}
                              </span>
                            )}
                            {!isTask && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#eff6ff', color: '#2563eb' }}>Meeting</span>
                            )}
                            {isTask && ev.resource?.task?.status && (
                              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                                {ev.resource.task.status.replace('_', ' ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight style={{ width: 14, height: 14, color: '#cbd5e1', flexShrink: 0, marginTop: 2 }} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Event Details Dialog - Professional Design */}
      <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
        <DialogContent padded={false} className="sm:max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
          {/* Accessibility - Visually Hidden Title & Description */}
          <DialogHeader className="sr-only">
            <DialogTitle>{selectedEvent?.title || 'Event Details'}</DialogTitle>
            <DialogDescription>
              {selectedEvent?.resource?.description || 'View event details'}
            </DialogDescription>
          </DialogHeader>

          {selectedEvent && (
            <>
              {/* Header with Color Accent */}
              <div
                className="px-6 pr-14 py-5 border-b"
                style={{
                  background: `linear-gradient(135deg, ${selectedEvent.resource?.color || '#3b82f6'}15, ${selectedEvent.resource?.color || '#3b82f6'}08)`,
                  borderLeft: `4px solid ${selectedEvent.resource?.color || '#3b82f6'}`
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: `${selectedEvent.resource?.color || '#3b82f6'}20`,
                          color: selectedEvent.resource?.color || '#3b82f6'
                        }}
                      >
                        {selectedEvent.resource?.type === 'DEADLINE' ? 'Task' :
                         selectedEvent.resource?.type === 'MEETING' ? 'Meeting' :
                         selectedEvent.resource?.type === 'PERSONAL' ? 'Holiday' : 'Event'}
                      </span>
                      {selectedEvent.allDay && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          All Day
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-foreground leading-tight" aria-hidden="true">
                      {selectedEvent.title.replace(/^\[(.*?)\]\s*/, '')}
                    </h2>
                    {selectedEvent.title.match(/^\[(.*?)\]/) && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {selectedEvent.title.match(/^\[(.*?)\]/)?.[1]}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Content Body */}
              <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
                {/* Date & Time Section */}
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary shrink-0">
                    <CalendarIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 pt-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {selectedEvent.start.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                    {!selectedEvent.allDay && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <Clock className="h-3.5 w-3.5" />
                        {selectedEvent.start.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })}
                        {selectedEvent.start.getTime() !== selectedEvent.end.getTime() && (
                          <>
                            <span className="text-muted-foreground/60">→</span>
                            {selectedEvent.end.toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </>
                        )}
                      </p>
                    )}
                    {selectedEvent.start.toDateString() !== selectedEvent.end.toDateString() && (
                      <p className="text-sm text-primary font-medium mt-1">
                        → {selectedEvent.end.toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Team Section */}
                {selectedEvent.resource?.team && (
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="flex-1 pt-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {selectedEvent.resource.team.name}
                      </p>
                      <p className="text-sm text-muted-foreground">Team</p>
                    </div>
                  </div>
                )}

                {/* Task Details Section */}
                {selectedEvent.resource?.task && (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Task Details</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Priority Badge */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                          selectedEvent.resource.task.priority === 'URGENT'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          selectedEvent.resource.task.priority === 'HIGH'
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                          selectedEvent.resource.task.priority === 'MEDIUM'
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}
                      >
                        <Flag className="h-3.5 w-3.5" />
                        {selectedEvent.resource.task.priority}
                      </span>
                      {/* Status Badge */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                          selectedEvent.resource.task.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          selectedEvent.resource.task.status === 'IN_PROGRESS'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                          selectedEvent.resource.task.status === 'IN_REVIEW'
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                            'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                      >
                        {selectedEvent.resource.task.status === 'COMPLETED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : selectedEvent.resource.task.status === 'IN_PROGRESS' ? (
                          <RefreshCw className="h-3.5 w-3.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5" />
                        )}
                        {selectedEvent.resource.task.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Description */}
                {selectedEvent.resource?.description && !selectedEvent.resource?.task && (
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 pt-0.5">
                      <p className="text-sm text-muted-foreground">
                        {selectedEvent.resource.description}
                      </p>
                    </div>
                  </div>
                )}

                {/* Creator Section */}
                {selectedEvent.resource?.creator && (
                  <div className="flex items-start gap-3 pt-2 border-t">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground shrink-0">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="flex-1 pt-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {selectedEvent.resource.creator.name}
                      </p>
                      <p className="text-xs text-muted-foreground">Created by</p>
                    </div>
                  </div>
                )}

                {/* Subtasks Section */}
                {selectedEvent.resource?.task && (
                  <div className="pt-2 border-t space-y-2">
                    {(() => {
                      const countAll = (list: NestedSubtask[]): number =>
                        list.reduce((sum, s) => sum + 1 + countAll(s.subtasks || []), 0)
                      const countDone = (list: NestedSubtask[]): number =>
                        list.reduce((sum, s) => sum + (s.status === 'COMPLETED' ? 1 : 0) + countDone(s.subtasks || []), 0)

                      const renderSubtasks = (list: NestedSubtask[], depth = 0): React.ReactNode => (
                        <div className={`space-y-1.5 min-w-0 ${depth > 0 ? 'mt-1.5 border-l-2 border-gray-100 pl-3' : 'pl-1'}`}>
                          {list.map((subtask) => (
                            <div key={subtask.id} className="min-w-0">
                              <div className="flex items-start gap-2 group min-w-0">
                                <button
                                  onClick={() => handleToggleSubtask(subtask.id, subtask.status)}
                                  disabled={togglingSubtaskId === subtask.id}
                                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors hover:scale-110 ${
                                    subtask.status === 'COMPLETED'
                                      ? 'bg-green-500 border-green-500'
                                      : subtask.status === 'IN_PROGRESS'
                                      ? 'border-blue-400 hover:bg-blue-50'
                                      : 'border-gray-300 hover:border-green-400 hover:bg-green-50'
                                  } ${togglingSubtaskId === subtask.id ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                                  title={subtask.status === 'COMPLETED' ? 'Mark incomplete' : 'Mark complete'}
                                >
                                  {subtask.status === 'COMPLETED' && (
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 8 8">
                                      <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                  {togglingSubtaskId === subtask.id && (
                                    <div className="w-2 h-2 rounded-full border border-gray-400 animate-spin border-t-transparent" />
                                  )}
                                </button>
                                <button
                                  onClick={() => { setIsEventDialogOpen(false); router.push(`/user/tasks?taskId=${subtask.id}`) }}
                                  className={`text-xs flex-1 text-left break-words min-w-0 hover:underline hover:text-blue-600 transition-colors ${subtask.status === 'COMPLETED' ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                                >
                                  {subtask.title}
                                </button>
                                {subtask.assignee && (
                                  <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                                    {subtask.assignee.name}
                                  </span>
                                )}
                              </div>
                              {subtask.subtasks && subtask.subtasks.length > 0 && renderSubtasks(subtask.subtasks, depth + 1)}
                            </div>
                          ))}
                        </div>
                      )

                      const allSubtasks = selectedEvent.resource?.subtasks || []
                      const total = countAll(allSubtasks)
                      const done = countDone(allSubtasks)

                      return (
                        <>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                              Subtasks
                              <span className="text-xs text-muted-foreground font-normal">({total})</span>
                            </p>
                            {total > 0 && (
                              <span className="text-xs text-muted-foreground">{done}/{total} done</span>
                            )}
                          </div>
                          {total === 0
                            ? <p className="text-xs text-muted-foreground pl-5">No subtasks</p>
                            : <div className="max-h-48 overflow-y-auto pr-1">{renderSubtasks(allSubtasks)}</div>
                          }
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              {selectedEvent.resource?.task?.id && (
                <div className="px-6 py-4 border-t bg-muted/20">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const taskId = selectedEvent.resource?.task?.id
                      if (taskId) {
                        setIsEventDialogOpen(false)
                        router.push(`/user/tasks?taskId=${taskId}`)
                      }
                    }}
                  >
                    View Task Details
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Calendar Sync Settings Modal */}
      <CalendarSyncSettingsModal
        isOpen={isSyncSettingsOpen}
        onClose={() => setIsSyncSettingsOpen(false)}
        onSyncComplete={fetchCalendarData}
      />


      {/* New Task from Day Sidebar */}
      <TaskForm
        open={isNewTaskFormOpen}
        onOpenChange={setIsNewTaskFormOpen}
        onSubmit={handleNewTaskSubmit}
        initialDueDate={selectedDate ?? undefined}
      />
    </div>
  )
}
