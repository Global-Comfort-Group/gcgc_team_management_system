'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { CheckSquare, Clock, AlertCircle, ArrowRight, Star, Zap, Target, Activity, Award, Calendar as CalendarIcon, Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScheduleHealthBadge } from '@/components/tasks/ScheduleHealthBadge'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserAvatar } from '@/components/shared/UserAvatar'
import { Button } from '@/components/ui/button'
import CreateTaskButton from '@/components/tasks/CreateTaskButton'
import { AtRiskTasksWidget } from '@/components/dashboard/at-risk-tasks-widget'
import { StatusDonut, CompletionTrend, PriorityBar, WorkloadBar } from '@/components/dashboard/dashboard-charts'
import { cn } from '@/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import { TASK_PRIORITY_COLORS, TASK_STATUS_COLORS } from '@/constants'

interface Task {
  id: string
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED'
  memberSubmittedAt?: string | null
  leaderEvaluatedAt?: string | null
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
  team?: {
    id: string
    name: string
  } | null
  createdAt: string
  updatedAt: string
}

interface TeamMember {
  id: string
  name: string
  firstName?: string
  lastName?: string
  email: string
  image?: string
  role: string
  updatedAt: string
}

interface DashboardStats {
  myTasks: number
  myCompletedTasks: number
  teamTasks: number
  overdueTasks: number
  teamMembersCount: number
}

interface DashboardData {
  stats: DashboardStats
  recentTasks: Task[]
  teamMembers: TeamMember[]
  upcomingDeadlines: Task[]
  teams: Array<{ id: string; name: string }>
  statusBreakdown: Array<{ status: string; count: number }>
  priorityBreakdown: Array<{ priority: string; count: number }>
  completionTrend: Array<{ weekStart: string; label: string; count: number }>
}

// Uniform wrapper so every chart/list card in a row shares the same chrome and
// stretches to equal height (fixes the mismatched-card-height problem).
function ChartCard({ title, subtitle, action, children, className }: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('border border-slate-200 bg-white shadow-sm rounded-xl flex flex-col', className)}>
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900">{title}</CardTitle>
            {subtitle && <CardDescription className="text-xs text-slate-500 mt-0.5">{subtitle}</CardDescription>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 flex-1">{children}</CardContent>
    </Card>
  )
}

export default function UserDashboard() {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Captured once on mount — used for the greeting + date (no need to tick).
  const [currentTime] = useState(new Date())
  const openTask = (taskId: string) => {
    router.push(`/user/tasks?taskId=${taskId}`)
  }

  useEffect(() => {
    if (!session?.user) return

    const fetchDashboardData = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/user/dashboard')
        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data')
        }
        const data = await response.json()
        setDashboardData(data)
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
        setError('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [session])

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'bg-red-100 text-red-700 border-red-200'
      case 'HIGH': return 'bg-orange-100 text-orange-700 border-orange-200'
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'LOW': return 'bg-green-100 text-green-700 border-green-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const getStatusColor = (updatedAt: string) => {
    const lastSeen = new Date(updatedAt)
    const now = new Date()
    const diffInHours = Math.abs(now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60)
    
    if (diffInHours < 1) return 'bg-green-500' // online
    if (diffInHours < 24) return 'bg-yellow-500' // away
    return 'bg-gray-400' // offline
  }

  const calculateTaskCompletionRate = () => {
    if (dashboardData?.stats.myTasks === 0) return 0
    return Math.round((dashboardData?.stats.myCompletedTasks || 0) / (dashboardData?.stats.myTasks || 1) * 100)
  }

  const getGreeting = () => {
    const hour = currentTime.getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const refreshDashboard = () => {
    if (!session?.user) return
    const fetchDashboardData = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/user/dashboard')
        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data')
        }
        const data = await response.json()
        setDashboardData(data)
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
        setError('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }
    fetchDashboardData()
  }

  // Auto-refresh when the tab regains focus, so the dashboard is current
  // without a manual Refresh button.
  useEffect(() => {
    const onFocus = () => refreshDashboard()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

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

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>No dashboard data available</p>
      </div>
    )
  }

  const isLeader = session?.user?.role === 'LEADER'

  return (
    <div className="space-y-6">
      {/* Header — refined hero (same white-card family, cleaner palette + depth) */}
      <div
        className="relative overflow-hidden rounded-2xl border border-slate-200/70 shadow-sm motion-safe:animate-slide-up"
        style={{ animationFillMode: 'backwards' }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-slate-50" />
        <div className="pointer-events-none absolute -top-24 -right-12 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-indigo-200/20 blur-3xl" />
        <div className="relative backdrop-blur-[2px] p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <h1 className="text-[1.75rem] sm:text-[2rem] font-bold text-slate-900 tracking-tight leading-none">
                  {getGreeting()}, {session?.user?.name?.split(' ')[0] || 'User'}
                </h1>
                <span className="text-2xl">👋</span>
              </div>
              <p className="text-slate-600 text-sm sm:text-base max-w-2xl">
                {isLeader
                  ? "Monitor your team's progress and stay on top of your tasks."
                  : "Focus on what matters. Here's your productivity snapshot."
                }
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500 pt-1">
                <span className="inline-flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-slate-400" />
                  <span className="font-medium">{format(currentTime, 'EEEE, MMMM do')}</span>
                </span>
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3">
              <CreateTaskButton size="sm" className="flex-1 sm:flex-none" onTaskCreated={refreshDashboard} />
            </div>
          </div>
        </div>
      </div>

      {/* Professional Stats Cards */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 motion-safe:animate-slide-up ${isLeader ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
        style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}
      >
        {/* Active Tasks Card */}
        <Card
          className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 cursor-pointer rounded-xl hover:-translate-y-1"
          onClick={() => router.push('/user/tasks')}
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-blue-600"></div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Active Tasks</CardTitle>
            <div className="p-2.5 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <CheckSquare className="h-5 w-5 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{dashboardData.stats.myTasks}</div>
              <span className="text-sm text-slate-500 font-medium">tasks</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">Completion rate</span>
                <span className="text-slate-900 font-semibold">{calculateTaskCompletionRate()}%</span>
              </div>
              <Progress value={calculateTaskCompletionRate()} className="h-2 bg-slate-100" />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">View all tasks</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>

        {/* Completed Tasks Card */}
        <Card
          className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 cursor-pointer rounded-xl hover:-translate-y-1"
          onClick={() => router.push('/user/tasks?status=completed')}
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-600"></div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Completed</CardTitle>
            <div className="p-2.5 bg-emerald-50 rounded-lg group-hover:bg-emerald-100 transition-colors">
              <Award className="h-5 w-5 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-bold text-slate-900">{dashboardData.stats.myCompletedTasks}</div>
              <span className="text-sm text-slate-500 font-medium">done</span>
            </div>
            {dashboardData.stats.myCompletedTasks > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 rounded-md w-fit">
                <Star className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs text-emerald-700 font-semibold">Nice work this month</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 rounded-md w-fit">
                <span className="text-xs text-slate-500 font-medium">Nothing completed yet</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">This month</span>
            </div>
          </CardContent>
        </Card>

        {/* Team Tasks Card (for Leaders) */}
        {isLeader && (
          <Card
            className="group relative overflow-hidden border border-slate-200 bg-white hover:shadow-lg transition-all duration-300 cursor-pointer rounded-xl hover:-translate-y-1"
            onClick={() => router.push('/user/team-overview')}
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-purple-600"></div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Team Tasks</CardTitle>
              <div className="p-2.5 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
                <Target className="h-5 w-5 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-slate-900">{dashboardData.stats.teamTasks}</div>
                <span className="text-sm text-slate-500 font-medium">active</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {dashboardData.teamMembers.slice(0, 3).map((member) => (
                    <UserAvatar
                      key={member.id}
                      userId={member.id}
                      image={member.image}
                      name={member.name}
                      email={member.email}
                      className="h-7 w-7 border-2 border-white ring-1 ring-slate-200"
                      fallbackClassName="text-xs bg-gradient-to-br from-blue-400 to-purple-500 text-white font-semibold"
                    />
                  ))}
                </div>
                <span className="text-xs text-slate-600 font-medium">{dashboardData.teamMembers.length} members</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs text-slate-500">Team activity</span>
                <Activity className="h-4 w-4 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        )}


        {/* Overdue Tasks Card */}
        <Card
          className={`group relative overflow-hidden border transition-all duration-300 rounded-xl ${
            dashboardData.stats.overdueTasks > 0
              ? 'border-red-200 bg-red-50 hover:shadow-lg cursor-pointer hover:-translate-y-1'
              : 'border-slate-200 bg-white hover:shadow-md'
          }`}
          onClick={() => dashboardData.stats.overdueTasks > 0 && (router.push('/user/tasks?status=overdue'))}
        >
          <div className={`absolute top-0 left-0 w-full h-1 ${
            dashboardData.stats.overdueTasks > 0
              ? 'bg-gradient-to-r from-red-500 to-red-600'
              : 'bg-gradient-to-r from-slate-300 to-slate-400'
          }`}></div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className={`text-sm font-semibold uppercase tracking-wide ${
              dashboardData.stats.overdueTasks > 0 ? 'text-red-700' : 'text-slate-600'
            }`}>
              Overdue
            </CardTitle>
            <div className={`p-2.5 rounded-lg group-hover:scale-110 transition-transform ${
              dashboardData.stats.overdueTasks > 0
                ? 'bg-red-100'
                : 'bg-slate-100'
            }`}>
              {dashboardData.stats.overdueTasks > 0 ? (
                <AlertCircle className="h-5 w-5 text-red-600" />
              ) : (
                <CheckSquare className="h-5 w-5 text-slate-500" />
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className={`text-4xl font-bold ${
                dashboardData.stats.overdueTasks > 0 ? 'text-red-600' : 'text-slate-400'
              }`}>
                {dashboardData.stats.overdueTasks}
              </div>
              <span className="text-sm text-slate-500 font-medium">tasks</span>
            </div>
            {dashboardData.stats.overdueTasks > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-100 rounded-md w-fit">
                <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                <span className="text-xs text-red-700 font-semibold">Needs attention</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 rounded-md w-fit">
                <Zap className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs text-emerald-700 font-semibold">All caught up!</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                {dashboardData.stats.overdueTasks > 0 ? 'Action required' : 'Great job'}
              </span>
              {dashboardData.stats.overdueTasks === 0 && (
                <span className="text-lg">🎉</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights — charts (equal-height row) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch motion-safe:animate-slide-up" style={{ animationDelay: '120ms', animationFillMode: 'backwards' }}>
        <ChartCard title="Tasks by status" subtitle="Where your work sits">
          <StatusDonut data={dashboardData.statusBreakdown} />
        </ChartCard>
        <ChartCard title="Completion trend" subtitle="Completed per week · last 8 weeks">
          <CompletionTrend data={dashboardData.completionTrend} />
        </ChartCard>
        <ChartCard title="Open tasks by priority" subtitle="What needs attention first">
          <PriorityBar data={dashboardData.priorityBreakdown} />
        </ChartCard>
      </div>

      {/* Leader: team workload chart + at-risk list */}
      {isLeader && (
        <ChartCard
          title="Team workload"
          subtitle="Active + overdue tasks per member"
          action={(
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => router.push('/user/member-management')}>
              Manage <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        >
          <WorkloadBar />
        </ChartCard>
      )}
      {isLeader && <AtRiskTasksWidget />}

      <div
        className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch motion-safe:animate-slide-up"
        style={{ animationDelay: '160ms', animationFillMode: 'backwards' }}
      >
        {/* Professional Recent Tasks */}
        <div className="h-full">
          <Card className="border border-slate-200 bg-white shadow-sm rounded-xl h-full flex flex-col">
            <CardHeader className="pb-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <CheckSquare className="h-4 w-4 text-blue-600" />
                    </div>
                    Recent Tasks
                  </CardTitle>
                  <CardDescription className="text-sm text-slate-600">
                    Your latest assignments and progress
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/user/tasks')}
                  className="text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                >
                  View All
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 flex-1">
              {dashboardData.recentTasks.length === 0 ? (
                <div className="text-center py-12">
                  <CheckSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-2">No recent tasks found</p>
                  <Button size="sm" onClick={() => router.push('/user/tasks')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Task
                  </Button>
                </div>
              ) : (
                dashboardData.recentTasks.slice(0, 3).map((task, index) => (
                  <div
                    key={task.id}
                    className="group relative border border-slate-200 bg-white rounded-lg p-4 hover:shadow-md hover:border-slate-300 transition-all duration-200 cursor-pointer"
                    onClick={() => openTask(task.id)}
                  >
                    {/* Priority indicator bar */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                      task.priority === 'URGENT' ? 'bg-red-500' :
                      task.priority === 'HIGH' ? 'bg-orange-500' :
                      task.priority === 'MEDIUM' ? 'bg-yellow-500' :
                      'bg-emerald-500'
                    }`}></div>

                    <div className="flex items-start justify-between ml-3 min-w-0 overflow-hidden">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-start gap-2 min-w-0">
                          <h4 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors break-words min-w-0">
                            {task.title}
                          </h4>
                          {index === 0 && (
                            <Badge className="text-xs bg-blue-100 text-blue-700 border-0 font-medium rounded-md">
                              Latest
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`text-xs ${getPriorityColor(task.priority)} font-medium rounded-md`}>
                            {task.priority}
                          </Badge>
                          {task.dueDate && (
                            <div className="flex items-center gap-1 text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                              <Clock className="h-3 w-3" />
                              Due {format(new Date(task.dueDate), 'MMM dd')}
                            </div>
                          )}
                          <ScheduleHealthBadge task={task} compact />
                          <Badge variant="outline" className="text-xs border-slate-200 text-slate-700 rounded-md">
                            {task.team?.name || 'Personal'}
                          </Badge>
                          {task.assignee && task.assignee.id !== session?.user?.id && (
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              <span>by</span>
                              <Avatar className="h-4 w-4 ring-1 ring-slate-200">
                                <AvatarFallback className="text-xs bg-gradient-to-br from-blue-100 to-purple-100 text-slate-700 font-medium">
                                  {task.assignee.name?.[0] || task.assignee.email[0]}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">{task.assignee.name?.split(' ')[0] || 'User'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge
                          variant={task.status === 'COMPLETED' ? 'default' : task.status === 'IN_PROGRESS' ? 'secondary' : 'outline'}
                          className="text-xs whitespace-nowrap border-slate-200 rounded-md"
                        >
                          {task.status.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-medium">
                          {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                      <div className="flex items-center gap-2">
                        {task.status === 'IN_PROGRESS' && (
                          <div className="flex items-center gap-1 text-xs text-blue-600">
                            <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse"></div>
                            Active
                          </div>
                        )}
                        {task.status === 'COMPLETED' && (
                          <div className="flex items-center gap-1 text-xs text-green-600">
                            <Award className="h-3 w-3" />
                            Completed
                          </div>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Deadlines */}
        <div className="h-full">
          <Card className="border border-slate-200 bg-white rounded-xl overflow-hidden h-full flex flex-col">
            <CardHeader className="pb-3 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
                  <div className="p-2 bg-orange-50 rounded-lg">
                    <Clock className="h-4 w-4 text-orange-600" />
                  </div>
                  Upcoming Deadlines
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded-full">Next 7 days</span>
                  {dashboardData.upcomingDeadlines.length > 5 && (
                    <button
                      onClick={() => router.push('/user/tasks')}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      +{dashboardData.upcomingDeadlines.length - 5} more
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {dashboardData.upcomingDeadlines.length === 0 ? (
                <div className="text-center py-6">
                  <CalendarIcon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 mb-1">No upcoming deadlines</p>
                  <p className="text-xs text-emerald-600 font-medium">You&apos;re all caught up!</p>
                </div>
              ) : (
                dashboardData.upcomingDeadlines.slice(0, 5).map((task) => {
                  const dueDate = task.dueDate ? new Date(task.dueDate) : null
                  const isUrgent = dueDate && dueDate.getTime() - new Date().getTime() < 2 * 24 * 60 * 60 * 1000
                  return (
                    <div key={task.id} className={`p-3 rounded-lg border transition-all cursor-pointer ${
                      isUrgent
                        ? 'bg-red-50 border-red-100 hover:border-red-200 hover:shadow-sm'
                        : 'bg-slate-50 border-slate-100 hover:border-slate-200 hover:shadow-sm'
                    }`} onClick={() => openTask(task.id)}>
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="font-semibold text-sm text-slate-800 flex-1 pr-2 break-words min-w-0">{task.title}</div>
                        {isUrgent && (
                          <Badge variant="destructive" className="text-xs bg-red-500 text-white border-0 font-semibold flex-shrink-0">
                            Urgent
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <Badge className={`text-xs ${getPriorityColor(task.priority)} border font-medium`}>
                          {task.priority}
                        </Badge>
                        {dueDate && (
                          <div className={`flex items-center gap-1 ${isUrgent ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                            <Clock className="h-3 w-3" />
                            {format(dueDate, 'MMM dd')}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  )
}
