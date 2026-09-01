'use client'

import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  User,
  Mail,
  Phone,
  Calendar,
  Briefcase,
  Building,
  Users,
  CheckSquare,
  Clock,
  AlertTriangle,
  Activity,
  Target,
  TrendingUp,
  MapPin,
  Hash,
  UserCheck,
  X,
  Filter,
  ChevronRight,
  ListTodo,
  Eye,
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import TaskViewModal from '@/components/tasks/TaskViewModal'

interface Task {
  id: string
  title: string
  description?: string
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string
  startDate?: string
  progressPercentage: number
  taskType: 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION'
  createdAt: string
  updatedAt: string
  assignee?: { id: string; name: string; email: string; image?: string }
  team?: { id: string; name: string }
}

interface MemberProfile {
  id: string
  name: string
  firstName?: string
  lastName?: string
  middleName?: string
  email: string
  image?: string
  role: string
  hierarchyLevel?: string
  contactNumber?: string
  positionTitle?: string
  username?: string
  shortName?: string
  division?: string
  department?: string
  section?: string
  team?: string
  jobLevel?: string
  isActive: boolean
  createdAt: string
  reportsToId: string | null
  assignedTasks: Task[]
  _count?: {
    assignedTasks: number
    completedTasks?: number
  }
}

type StatusFilter = 'ALL' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'OVERDUE'

interface MemberProfileModalProps {
  isOpen: boolean
  onClose: () => void
  memberId: string | null
}

export default function MemberProfileModal({ isOpen, onClose, memberId }: MemberProfileModalProps) {
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null)
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [viewingTask, setViewingTask] = useState<Task | null>(null)

  useEffect(() => {
    if (isOpen && memberId) {
      fetchMemberProfile()
      setStatusFilter('ALL')
    }
  }, [isOpen, memberId])

  const fetchMemberProfile = async () => {
    if (!memberId) return
    try {
      setLoading(true)
      setError(null)

      // Fetch profile + all tasks (including completed) in parallel
      const [profileRes, tasksRes] = await Promise.all([
        fetch(`/api/user/team-members/${memberId}`),
        fetch(`/api/tasks?assigneeId=${memberId}&limit=500`),
      ])

      if (!profileRes.ok) throw new Error('Failed to fetch member profile')

      const profileData = await profileRes.json()
      setMemberProfile(profileData)

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json()
        setAllTasks(tasksData.tasks || [])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to load member profile: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'TODO':        return 'bg-slate-100 text-slate-700 border-slate-300'
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-700 border-blue-300'
      case 'IN_REVIEW':   return 'bg-amber-100 text-amber-700 border-amber-300'
      case 'COMPLETED':   return 'bg-emerald-100 text-emerald-700 border-emerald-300'
      default:            return 'bg-slate-100 text-slate-700 border-slate-300'
    }
  }

  const getStatusAccent = (status: string) => {
    switch (status) {
      case 'TODO':        return 'border-l-slate-400'
      case 'IN_PROGRESS': return 'border-l-blue-400'
      case 'IN_REVIEW':   return 'border-l-amber-400'
      case 'COMPLETED':   return 'border-l-emerald-400'
      default:            return 'border-l-slate-300'
    }
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

  // Status filter tabs definition
  const filterTabs: { key: StatusFilter; label: string; danger?: boolean }[] = [
    { key: 'ALL',         label: 'All'         },
    { key: 'TODO',        label: 'To Do'       },
    { key: 'IN_PROGRESS', label: 'In Progress' },
    { key: 'IN_REVIEW',   label: 'In Review'   },
    { key: 'COMPLETED',   label: 'Completed'   },
    { key: 'OVERDUE',     label: 'Overdue', danger: true },
  ]

  const sot = new Date(); sot.setHours(0, 0, 0, 0)
  const isTaskOverdue = (t: Task) => !!t.dueDate && new Date(t.dueDate) < sot && t.status !== 'COMPLETED'

  const filteredTasks = statusFilter === 'ALL'
    ? allTasks
    : statusFilter === 'OVERDUE'
    ? allTasks.filter(isTaskOverdue)
    : allTasks.filter(t => t.status === statusFilter)

  const taskCounts = {
    ALL:         allTasks.length,
    TODO:        allTasks.filter(t => t.status === 'TODO').length,
    IN_PROGRESS: allTasks.filter(t => t.status === 'IN_PROGRESS').length,
    IN_REVIEW:   allTasks.filter(t => t.status === 'IN_REVIEW').length,
    COMPLETED:   allTasks.filter(t => t.status === 'COMPLETED').length,
    OVERDUE:     allTasks.filter(isTaskOverdue).length,
  }

  const completionRate = allTasks.length > 0
    ? Math.round((taskCounts.COMPLETED / allTasks.length) * 100)
    : 0

  if (!isOpen) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent padded={false} className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="px-6 pr-14 pt-6 pb-4 border-b border-slate-100 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <div className="p-1.5 bg-blue-50 rounded-lg">
                <User className="h-4 w-4 text-blue-600" />
              </div>
              Member Profile
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center space-y-3">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
                  <p className="text-sm text-slate-500">Loading profile...</p>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                  <p className="text-red-600 mb-4">{error}</p>
                  <Button onClick={fetchMemberProfile}>Try Again</Button>
                </div>
              </div>
            )}

            {memberProfile && (
              <div className="space-y-0 divide-y divide-slate-100">

                {/* ── Profile Header ── */}
                <div className="px-6 py-5 bg-gradient-to-br from-blue-50 via-slate-50 to-purple-50">
                  <div className="flex items-start gap-5">
                    <div className="relative shrink-0">
                      <Avatar className="h-16 w-16 ring-4 ring-white shadow-md">
                        <AvatarImage src={memberProfile.image || undefined} />
                        <AvatarFallback className="bg-blue-100 text-blue-700 font-bold text-xl">
                          {memberProfile.name
                            ? memberProfile.name.split(' ').map(n => n[0]).join('').slice(0, 2)
                            : memberProfile.email?.[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white",
                        memberProfile.isActive ? "bg-emerald-500" : "bg-slate-400"
                      )} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-xl font-bold text-slate-900 truncate">
                          {memberProfile.name || 'Unnamed User'}
                        </h2>
                        <Badge className={cn("text-xs border shrink-0", memberProfile.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200")}>
                          {memberProfile.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                        {memberProfile.positionTitle && (
                          <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{memberProfile.positionTitle}</span>
                        )}
                        <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{memberProfile.email}</span>
                        {memberProfile.contactNumber && (
                          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{memberProfile.contactNumber}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />Joined {format(new Date(memberProfile.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>

                    {/* Quick task stats */}
                    <div className="flex items-center gap-3 shrink-0">
                      {[
                        { label: 'Total', value: allTasks.length, color: 'text-slate-900' },
                        { label: 'Active', value: taskCounts.IN_PROGRESS + taskCounts.TODO + taskCounts.IN_REVIEW, color: 'text-blue-600' },
                        { label: 'Done', value: taskCounts.COMPLETED, color: 'text-emerald-600' },
                      ].map(stat => (
                        <div key={stat.label} className="text-center bg-white/70 rounded-xl px-3 py-2 border border-slate-200/60 shadow-sm">
                          <p className={cn("text-xl font-bold", stat.color)}>{stat.value}</p>
                          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{stat.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Info Grid ── */}
                <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">

                  {/* Personal */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" /> Personal Information
                    </h3>
                    <div className="space-y-2 text-sm">
                      {[
                        { label: 'Full Name', value: memberProfile.name },
                        { label: 'Username', value: memberProfile.username },
                        { label: 'Short Name', value: memberProfile.shortName },
                        { label: 'Role', value: memberProfile.role },
                        { label: 'Job Level', value: memberProfile.jobLevel },
                      ].filter(f => f.value).map(field => (
                        <div key={field.label} className="flex items-center justify-between py-1 border-b border-slate-50">
                          <span className="text-slate-500">{field.label}</span>
                          <span className="font-medium text-slate-800">{field.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Organizational */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5" /> Organizational
                    </h3>
                    <div className="space-y-2 text-sm">
                      {(memberProfile.division || memberProfile.department || memberProfile.section || memberProfile.team) && (
                        <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 text-slate-600 text-xs">
                          <div className="flex items-center gap-1 text-slate-400 mb-1"><MapPin className="h-3 w-3" />Path</div>
                          {[memberProfile.division, memberProfile.department, memberProfile.section, memberProfile.team]
                            .filter(Boolean).join(' → ')}
                        </div>
                      )}
                      {[
                        { label: 'Hierarchy Level', value: memberProfile.hierarchyLevel },
                      ].filter(f => f.value).map(field => (
                        <div key={field.label} className="flex items-center justify-between py-1 border-b border-slate-50">
                          <span className="text-slate-500">{field.label}</span>
                          <span className="font-medium text-slate-800">{field.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Task Overview ── */}
                <div className="px-6 py-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5" /> Task Overview
                    </h3>
                    <span className="text-xs text-slate-400">{completionRate}% completion rate</span>
                  </div>

                  {/* Mini completion bar */}
                  {allTasks.length > 0 && (
                    <div className="mb-5">
                      <Progress value={completionRate} className="h-1.5 bg-slate-100 mb-1" />
                      <div className="flex items-center gap-4 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-400 inline-block" />To Do ({taskCounts.TODO})</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" />In Progress ({taskCounts.IN_PROGRESS})</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />In Review ({taskCounts.IN_REVIEW})</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />Done ({taskCounts.COMPLETED})</span>
                      </div>
                    </div>
                  )}

                  {/* Status Filter Tabs */}
                  <div className="flex items-center gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit flex-wrap">
                    {filterTabs.map(tab => {
                      const isActive = statusFilter === tab.key
                      const isDanger = tab.danger && taskCounts[tab.key] > 0
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setStatusFilter(tab.key)}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                            isActive
                              ? isDanger ? "bg-white text-red-600 shadow-sm" : "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-700"
                          )}
                        >
                          {tab.label}
                          <span className={cn(
                            "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold",
                            isActive
                              ? isDanger ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                              : isDanger ? "bg-red-50 text-red-500" : "bg-slate-200 text-slate-500"
                          )}>
                            {taskCounts[tab.key]}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Task List */}
                  {filteredTasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="p-3 bg-slate-100 rounded-full mb-3">
                        <ListTodo className="h-6 w-6 text-slate-300" />
                      </div>
                      <p className="text-sm font-medium text-slate-500">No tasks</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {statusFilter === 'ALL' ? 'No tasks assigned' : `No ${statusFilter.replace('_', ' ').toLowerCase()} tasks`}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredTasks.map((task) => {
                          const overdue = isTaskOverdue(task)
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              "group bg-white rounded-xl border border-slate-200 border-l-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer",
                              getStatusAccent(task.status)
                            )}
                            onClick={() => setViewingTask(task)}
                          >
                            <div className="p-4">
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-sm font-semibold text-slate-900 leading-snug">{task.title}</h4>
                                  {task.description && (
                                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>
                                  )}
                                </div>
                                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
                              </div>

                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge className={cn("text-[10px] px-1.5 h-5 border font-medium", getPriorityColor(task.priority))}>
                                    {task.priority}
                                  </Badge>
                                  <Badge className={cn("text-[10px] px-1.5 h-5 border font-medium", getStatusColor(task.status))}>
                                    {task.status.replace(/_/g, ' ')}
                                  </Badge>
                                  {overdue && (
                                    <Badge className="text-[10px] px-1.5 h-5 bg-red-50 text-red-600 border border-red-200 font-medium">
                                      Overdue
                                    </Badge>
                                  )}
                                  {task.dueDate && (
                                    <span className={cn("text-xs flex items-center gap-1", overdue ? "text-red-500 font-medium" : "text-slate-400")}>
                                      <Clock className="h-3 w-3" />
                                      {format(new Date(task.dueDate), 'MMM d, yyyy')}
                                    </span>
                                  )}
                                </div>
                                {task.progressPercentage > 0 && (
                                  <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
                                    <TrendingUp className="h-3 w-3" />{task.progressPercentage}%
                                  </span>
                                )}
                              </div>

                              {task.progressPercentage > 0 && (
                                <div className="mt-2">
                                  <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                                    <div
                                      className={cn("h-full rounded-full", task.progressPercentage >= 75 ? "bg-emerald-500" : task.progressPercentage >= 40 ? "bg-blue-500" : "bg-amber-500")}
                                      style={{ width: `${task.progressPercentage}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>

          <div className="flex justify-end px-6 py-4 border-t border-slate-100 shrink-0">
            <Button variant="outline" onClick={onClose} className="border-slate-200">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task Detail Modal — opens on top of profile modal */}
      <TaskViewModal
        open={!!viewingTask}
        onOpenChange={(open) => { if (!open) setViewingTask(null) }}
        task={viewingTask as any}
        onTaskUpdate={fetchMemberProfile}
      />
    </>
  )
}
