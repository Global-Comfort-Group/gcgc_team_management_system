'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckSquare,
  Search,
  User,
  Clock,
  AlertTriangle,
  CheckCircle,
  Play,
  Pause,
  Users,
  Calendar,
  Eye,
  MessageSquare,
  Target,
  GitBranch,
  UserPlus,
  LayoutList,
  LayoutGrid
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScheduleHealthBadge } from '@/components/tasks/ScheduleHealthBadge'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { UserRole, TaskStatus, HierarchyLevel } from '@prisma/client'

interface TaskUser {
  id: string
  name: string
  email: string
  role: UserRole
  hierarchyLevel: HierarchyLevel | null
  isActive: boolean
  relationship: 'assignee' | 'creator' | 'collaborator'
}

interface TaskData {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: string
  dueDate?: string
  memberSubmittedAt?: string | null
  leaderEvaluatedAt?: string | null
  createdAt: string
  updatedAt: string
  assignee?: TaskUser
  creator?: TaskUser
  collaborators?: Array<{
    user: TaskUser
  }>
  team?: {
    id: string
    name: string
    description?: string
  }
  comments?: Array<{
    id: string
    content: string
    createdAt: string
    author: {
      id: string
      name: string
      email: string
      role: UserRole
    }
  }>
  _count: {
    comments: number
    collaborators: number
  }
  isOverdue: boolean
  taskType: 'Individual' | 'Collaborative' | 'Team Task'
  involvedUserCount: number
  relationshipTypes: string[]
  allInvolvedUsers: TaskUser[]
}

interface TaskStats {
  totalTasks: number
  pendingTasks: number
  inProgressTasks: number
  completedTasks: number
  overdueTasks: number
  collaborativeTasks: number
  teamTasks: number
  individualTasks: number
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export default function UserTasksPage() {
  const [tasks, setTasks] = useState<TaskData[]>([])
  const [stats, setStats] = useState<TaskStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [apiSearchTerm, setApiSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [taskTypeFilter, setTaskTypeFilter] = useState<'all' | 'individual' | 'collaborative' | 'team'>('all')
  const [viewMode, setViewMode] = useState<'column' | 'grid'>('grid')
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 6,
    total: 0,
    totalPages: 0,
    hasMore: false
  })
  
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(apiSearchTerm && { search: apiSearchTerm }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(taskTypeFilter !== 'all' && { taskType: taskTypeFilter })
      })

      // Debug search requests
      if (apiSearchTerm) {
        console.log('Searching for:', apiSearchTerm)
      }

      const response = await fetch(`/api/admin/users/tasks?${params}`)
      const data = await response.json()

      if (response.ok) {
        setTasks(data.tasks)
        setStats(data.stats)
        setPagination(data.pagination)
      } else {
        console.error('API Error:', data)
      }
    } catch (error) {
      console.error('Error fetching tasks:', error)
    } finally {
      setLoading(false)
    }
  }, [pagination.page, apiSearchTerm, statusFilter, taskTypeFilter])

  // Reset to page 1 when search or filters change
  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }))
  }, [apiSearchTerm, statusFilter, taskTypeFilter])

  // Handle search input changes with throttling
  const handleSearchChange = useCallback((value: string) => {
    // Update UI immediately (no lag in typing)
    setSearchTerm(value)
    
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    // Set new timeout for API call
    searchTimeoutRef.current = setTimeout(() => {
      setApiSearchTerm(value)
    }, 300) // 300ms delay for API calls only
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  // Fetch tasks when dependencies change
  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case 'TODO': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'IN_REVIEW': return 'bg-purple-100 text-purple-700 border-purple-200'
      case 'COMPLETED': return 'bg-green-100 text-green-700 border-green-200'
      case 'CANCELLED': return 'bg-gray-100 text-gray-700 border-gray-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'TODO': return <Clock className="w-3 h-3" />
      case 'IN_PROGRESS': return <Play className="w-3 h-3" />
      case 'IN_REVIEW': return <Eye className="w-3 h-3" />
      case 'COMPLETED': return <CheckCircle className="w-3 h-3" />
      case 'CANCELLED': return <Pause className="w-3 h-3" />
      default: return <Clock className="w-3 h-3" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority?.toUpperCase()) {
      case 'HIGH': return 'bg-red-100 text-red-700 border-red-200'
      case 'MEDIUM': return 'bg-orange-100 text-orange-700 border-orange-200'
      case 'LOW': return 'bg-green-100 text-green-700 border-green-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case 'ADMIN': return 'bg-red-100 text-red-700 border-red-200'
      case 'LEADER': return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'MEMBER': return 'bg-green-100 text-green-700 border-green-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">User Tasks Management</h1>
          <p className="text-gray-600">View all tasks and their user relationships (assigned, created, collaborative)</p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge className="bg-blue-100 text-blue-700">
            {pagination.total} Tasks
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <form 
        onSubmit={(e) => {
          e.preventDefault()
          return false
        }}
        className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-4"
      >
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search by user name or email..."
            value={searchTerm}
            onChange={(e) => {
              handleSearchChange(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            autoComplete="off"
            spellCheck="false"
            className="pl-10 pr-10"
          />
          {loading && searchTerm && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
            </div>
          )}
        </div>

        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TaskStatus | 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Task status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="TODO">To Do</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="IN_REVIEW">In Review</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={taskTypeFilter} onValueChange={(value) => setTaskTypeFilter(value as 'all' | 'individual' | 'collaborative' | 'team')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Task type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="collaborative">Collaboration</SelectItem>
            <SelectItem value="team">Team</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center border border-slate-200 rounded-lg p-1">
          <Button
            type="button"
            variant={viewMode === 'column' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('column')}
            className="h-8 w-8 p-0"
          >
            <LayoutList className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 p-0"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </form>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalTasks}</div>
              <p className="text-xs text-muted-foreground">
                All task types
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <Play className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.inProgressTasks}</div>
              <p className="text-xs text-muted-foreground">
                Currently active
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overdue Tasks</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.overdueTasks}</div>
              <p className="text-xs text-muted-foreground">
                Need attention
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Collaborative</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.collaborativeTasks}</div>
              <p className="text-xs text-muted-foreground">
                Team efforts
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tasks List */}
      <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'grid gap-4'}>
        {tasks.map((task) => (
          <Dialog key={task.id}>
            <DialogTrigger asChild>
              <Card
                className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => setSelectedTask(task)}
              >
                {viewMode === 'grid' ? (
                  // Grid View - Compact vertical layout
                  <div className="p-4">
                    <div className="flex flex-col items-center text-center">
                      <div className={`p-2 rounded-lg mb-3 ${task.isOverdue ? 'bg-red-100' : 'bg-blue-100'}`}>
                        <CheckSquare className={`w-6 h-6 ${task.isOverdue ? 'text-red-500' : 'text-blue-500'}`} />
                      </div>
                      <h3 className="font-semibold text-gray-900 text-sm mb-1 line-clamp-2">
                        {task.title}
                        {task.isOverdue && (
                          <AlertTriangle className="w-3 h-3 text-red-500 inline ml-1" />
                        )}
                      </h3>

                      {/* Status and Priority */}
                      <div className="flex items-center justify-center flex-wrap gap-1 mb-3">
                        <Badge className={`${getStatusColor(task.status)} text-xs`}>
                          {getStatusIcon(task.status)}
                          <span className="ml-1">{task.status}</span>
                        </Badge>
                        {task.priority && (
                          <Badge className={`${getPriorityColor(task.priority)} text-xs`}>
                            {task.priority}
                          </Badge>
                        )}
                      </div>

                      <Badge variant="outline" className="bg-gray-50 text-xs mb-3">
                        {task.taskType}
                      </Badge>

                      {/* Assignee */}
                      {task.assignee && (
                        <div className="flex items-center justify-center space-x-2 mb-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">
                              {task.assignee.name ? task.assignee.name.split(' ').map(n => n[0]).join('') : 'A'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs font-medium truncate max-w-[100px]">{task.assignee.name}</span>
                        </div>
                      )}

                      {/* Due Date */}
                      {task.dueDate && (
                        <div className="flex items-center justify-center gap-1.5 mb-3">
                          <Badge variant={task.isOverdue ? "destructive" : "outline"} className="text-xs">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Date(task.dueDate).toLocaleDateString()}
                          </Badge>
                          <ScheduleHealthBadge task={task} compact />
                        </div>
                      )}

                      {/* Stats */}
                      <div className="flex items-center justify-center gap-3 text-xs text-gray-500 pt-2 border-t border-gray-100 w-full">
                        <div className="flex items-center space-x-1">
                          <Users className="w-3 h-3" />
                          <span>{task.involvedUserCount}</span>
                        </div>
                        {task._count.comments > 0 && (
                          <div className="flex items-center space-x-1">
                            <MessageSquare className="w-3 h-3" />
                            <span>{task._count.comments}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  // Column View - Horizontal layout
                  <>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0">
                              <CheckSquare className={`w-5 h-5 ${task.isOverdue ? 'text-red-500' : 'text-blue-500'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                                <span className="truncate">{task.title}</span>
                                {task.isOverdue && (
                                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                )}
                              </h3>
                              {task.description && (
                                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{task.description}</p>
                              )}

                              {/* Status and Priority Badges */}
                              <div className="flex items-center space-x-2 mt-2">
                                <Badge className={getStatusColor(task.status)}>
                                  {getStatusIcon(task.status)}
                                  <span className="ml-1">{task.status}</span>
                                </Badge>
                                {task.priority && (
                                  <Badge className={getPriorityColor(task.priority)}>
                                    {task.priority}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="bg-gray-50">
                                  {task.taskType}
                                </Badge>
                                {task.dueDate && (
                                  <Badge variant={task.isOverdue ? "destructive" : "outline"}>
                                    <Calendar className="w-3 h-3 mr-1" />
                                    {new Date(task.dueDate).toLocaleDateString()}
                                  </Badge>
                                )}
                                <ScheduleHealthBadge task={task} compact />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
                          <Badge variant="outline" className="bg-blue-50 text-blue-700">
                            <Eye className="w-3 h-3 mr-1" />
                            Click to view
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                      {/* User relationships summary */}
                      <div className="space-y-3">
                        {/* Assigned To */}
                        {task.assignee && (
                          <div className="flex items-center space-x-2">
                            <Target className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-gray-600">Assigned to:</span>
                            <div className="flex items-center space-x-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-xs">
                                  {task.assignee.name ? task.assignee.name.split(' ').map(n => n[0]).join('') : 'A'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium">{task.assignee.name}</span>
                              <Badge className={getRoleColor(task.assignee.role)}>
                                {task.assignee.role}
                              </Badge>
                            </div>
                          </div>
                        )}

                        {/* Created By */}
                        {task.creator && (
                          <div className="flex items-center space-x-2">
                            <UserPlus className="w-4 h-4 text-blue-600" />
                            <span className="text-sm text-gray-600">Created by:</span>
                            <div className="flex items-center space-x-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-xs">
                                  {task.creator.name ? task.creator.name.split(' ').map(n => n[0]).join('') : 'C'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium">{task.creator.name}</span>
                              <Badge className={getRoleColor(task.creator.role)}>
                                {task.creator.role}
                              </Badge>
                            </div>
                          </div>
                        )}

                        {/* Collaborators */}
                        {task.collaborators && task.collaborators.length > 0 && (
                          <div className="flex items-start space-x-2">
                            <Users className="w-4 h-4 text-purple-600 mt-1" />
                            <div className="flex-1">
                              <span className="text-sm text-gray-600">Collaborators ({task.collaborators.length}):</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {task.collaborators.slice(0, 3).map((collab) => (
                                  <div key={collab.user.id} className="flex items-center space-x-1 bg-gray-100 rounded-full px-2 py-1">
                                    <Avatar className="h-4 w-4">
                                      <AvatarFallback className="text-xs">
                                        {collab.user.name ? collab.user.name.split(' ').map(n => n[0]).join('') : 'C'}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="text-xs font-medium">{collab.user.name}</span>
                                  </div>
                                ))}
                                {task.collaborators.length > 3 && (
                                  <span className="text-xs text-gray-500 self-center">
                                    +{task.collaborators.length - 3} more
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Team */}
                        {task.team && (
                          <div className="flex items-center space-x-2">
                            <GitBranch className="w-4 h-4 text-orange-600" />
                            <span className="text-sm text-gray-600">Team:</span>
                            <Badge variant="outline">
                              <Users className="w-3 h-3 mr-1" />
                              {task.team.name}
                            </Badge>
                          </div>
                        )}

                        {/* Task Stats */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                            {task._count.comments > 0 && (
                              <div className="flex items-center space-x-1">
                                <MessageSquare className="w-3 h-3" />
                                <span>{task._count.comments} comments</span>
                              </div>
                            )}
                            <div className="flex items-center space-x-1">
                              <Users className="w-3 h-3" />
                              <span>{task.involvedUserCount} users involved</span>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500">
                            Updated {new Date(task.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </>
                )}
              </Card>
            </DialogTrigger>

            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{task.title}</DialogTitle>
                <DialogDescription>
                  Task details and user relationships
                </DialogDescription>
              </DialogHeader>
              {selectedTask && selectedTask.id === task.id && (
                <div className="space-y-6">
                  {/* Task Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold mb-2">Task Information</h4>
                      <div className="space-y-2 text-sm">
                        <div><strong>Status:</strong> {selectedTask.status}</div>
                        <div><strong>Priority:</strong> {selectedTask.priority}</div>
                        <div><strong>Type:</strong> {selectedTask.taskType}</div>
                        {selectedTask.dueDate && (
                          <div><strong>Due Date:</strong> {new Date(selectedTask.dueDate).toLocaleDateString()}</div>
                        )}
                        <div><strong>Created:</strong> {new Date(selectedTask.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">Involvement</h4>
                      <div className="space-y-2 text-sm">
                        <div><strong>Users Involved:</strong> {selectedTask.involvedUserCount}</div>
                        <div><strong>Collaborators:</strong> {selectedTask._count.collaborators}</div>
                        <div><strong>Comments:</strong> {selectedTask._count.comments}</div>
                        {selectedTask.team && (
                          <div><strong>Team:</strong> {selectedTask.team.name}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  {selectedTask.description && (
                    <div>
                      <h4 className="font-semibold mb-2">Description</h4>
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">{selectedTask.description}</p>
                    </div>
                  )}

                  {/* All Involved Users */}
                  <div>
                    <h4 className="font-semibold mb-3">All Involved Users</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {selectedTask.allInvolvedUsers.map((user) => (
                        <div key={`${user.id}-${user.relationship}`} className="flex items-center space-x-3 p-3 border rounded-lg">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {user.name ? user.name.split(' ').map(n => n[0]).join('') : <User className="w-4 h-4" />}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{user.name}</div>
                            <div className="text-xs text-gray-500 truncate">{user.email}</div>
                          </div>
                          <div className="flex flex-col items-end space-y-1">
                            <Badge className={getRoleColor(user.role)}>
                              {user.role}
                            </Badge>
                            <Badge variant="outline">
                              {user.relationship}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Comments */}
                  {selectedTask.comments && selectedTask.comments.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3">Recent Comments</h4>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {selectedTask.comments.map((comment) => (
                          <div key={comment.id} className="p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center space-x-2 mb-1">
                              <span className="font-medium text-sm">{comment.author.name}</span>
                              <span className="text-xs text-gray-500">
                                {new Date(comment.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700">{comment.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        ))}
      </div>

      {/* Pagination */}
      {pagination.total > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <PaginationInfo
              currentPage={pagination.page}
              pageSize={pagination.limit}
              totalItems={pagination.total}
            />
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={(page) => setPagination({ ...pagination, page })}
              disabled={loading}
            />
          </div>
        </div>
      )}

      {tasks.length === 0 && !loading && (
        <div className="text-center py-12">
          <CheckSquare className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No tasks found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm ? 'No tasks match your search criteria.' : 'No tasks found in the system.'}
          </p>
        </div>
      )}
    </div>
  )
}