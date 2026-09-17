'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import {
  Plus,
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
  RefreshCw
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import TaskForm from '@/components/tasks/TaskForm'
import TaskViewModal from '@/components/tasks/TaskViewModal'

interface Task {
  id: string
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string
  startDate?: string
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED'
  progressPercentage: number
  taskType: 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION'
  // Google Calendar fields
  location?: string
  meetingLink?: string
  allDay?: boolean
  recurrence?: string
  reminders?: any
  // Recurring task
  recurringParentId?: string | null
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
  createdAt: string
  updatedAt: string
}

interface User {
  id: string
  name: string
  email: string
  image?: string
}

const COLUMN_CONFIG = {
  TODO: { title: 'To Do', color: 'bg-gray-100', textColor: 'text-gray-700' },
  IN_PROGRESS: { title: 'In Progress', color: 'bg-blue-100', textColor: 'text-blue-700' },
  IN_REVIEW: { title: 'In Review', color: 'bg-yellow-100', textColor: 'text-yellow-700' },
  COMPLETED: { title: 'Completed', color: 'bg-green-100', textColor: 'text-green-700' },
  CANCELLED: { title: 'Cancelled', color: 'bg-red-100', textColor: 'text-red-700' },
}

export default function AdminTasksPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [users, setUsers] = useState<User[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [deleteScope, setDeleteScope] = useState<'single' | 'series'>('single')

  // Debounce search term to avoid refetching on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 500) // Wait 500ms after user stops typing

    return () => clearTimeout(timer)
  }, [searchTerm])

  const fetchTasks = async () => {
    if (!session?.user) return

    try {
      setError(null)
      const params = new URLSearchParams()
      if (debouncedSearchTerm) params.append('search', debouncedSearchTerm)
      if (selectedUser) params.append('userId', selectedUser)
      if (statusFilter) params.append('status', statusFilter)
      
      console.log('Fetching admin tasks with params:', params.toString())
      
      const response = await fetch(`/api/tasks?${params}`)
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('Fetch tasks error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch tasks')
      }
      
      const data = await response.json()
      console.log('Tasks fetched:', data.tasks?.length || 0, 'tasks')
      setTasks(data.tasks || [])
      setHasLoadedOnce(true)
    } catch (err) {
      console.error('Error fetching tasks:', err)
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    // session?.user?.id is a stable primitive — using full session here
    // would re-fire on NextAuth's window-focus session refresh and could
    // unmount any open task dialog by flipping `loading` to true.
  }, [session?.user?.id, debouncedSearchTerm, selectedUser, statusFilter])

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

  useEffect(() => {
    if (session?.user) {
      fetchUsers()
    }
  }, [session])

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return

    const { draggableId, destination, source } = result
    const newStatus = destination.droppableId as Task['status']
    const originalStatus = source.droppableId as Task['status']
    
    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return
    }
    
    setTasks(prev => 
      prev.map(task => 
        task.id === draggableId 
          ? { ...task, status: newStatus } 
          : task
      )
    )

    try {
      const response = await fetch(`/api/tasks/${draggableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to update task status`)
      }

      const updatedTask = await response.json()
      
      setTasks(prev => 
        prev.map(task => 
          task.id === draggableId ? updatedTask : task
        )
      )

      toast({
        title: 'Success',
        description: `Task moved to ${COLUMN_CONFIG[newStatus].title}`,
      })

    } catch (err) {
      console.error('Error updating task status:', err)
      
      setTasks(prev => 
        prev.map(task => 
          task.id === draggableId 
            ? { ...task, status: originalStatus } 
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
      default: return <User className="h-3 w-3" />
    }
  }

  const getTasksByStatus = (status: Task['status']) => 
    tasks.filter(task => task.status === status)

  const handleCreateTask = async (taskData: any) => {
    try {
      // Extract subtasks from data
      const { subtasks, ...mainTaskData } = taskData
      console.log('Creating task with data:', mainTaskData)

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
      console.log('Task created successfully:', newTask)

      // Create subtasks if any
      if (subtasks && subtasks.length > 0) {
        const subtaskPromises = subtasks.map((subtask: { title: string; assigneeId: string }) =>
          fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: subtask.title,
              parentId: newTask.id,
              priority: mainTaskData.priority,
              taskType: 'INDIVIDUAL',
              assigneeId: subtask.assigneeId,
            }),
          })
        )
        await Promise.all(subtaskPromises)
      }

      await fetchTasks()

      const subtaskCount = subtasks?.length || 0
      toast({
        title: 'Success',
        description: subtaskCount > 0
          ? `Task created with ${subtaskCount} subtask${subtaskCount !== 1 ? 's' : ''}`
          : 'Task created successfully'
      })
    } catch (error) {
      // TaskForm shows the error and keeps the user's input; rethrow so it
      // doesn't close and wipe the form as if the task had been created.
      console.error('Error creating task:', error)
      throw error
    }
  }

  const handleUpdateTask = async (taskData: any) => {
    if (!editingTask) return

    try {
      console.log('Updating task:', editingTask.id, 'with data:', taskData)
      
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

      const updatedTask = await response.json()
      console.log('Task updated successfully:', updatedTask)
      
      await fetchTasks()
      
      setEditingTask(null)
      toast({
        title: 'Success',
        description: 'Task updated successfully'
      })
    } catch (error) {
      console.error('Error updating task:', error)
      throw error
    }
  }

  const handleDeleteTask = async () => {
    if (!deletingTask) return

    try {
      console.log('Deleting task:', deletingTask.id, deletingTask.title)

      const url = deleteScope === 'series' && deletingTask.recurringParentId
        ? `/api/tasks/${deletingTask.id}?scope=series`
        : `/api/tasks/${deletingTask.id}`

      const response = await fetch(url, { method: 'DELETE' })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Delete task error response:', errorData)
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to delete task`)
      }

      console.log('Task deleted successfully')

      await fetchTasks()

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

  const openEditForm = (task: Task) => {
    setEditingTask(task)
    setShowTaskForm(true)
  }

  const closeTaskForm = () => {
    setShowTaskForm(false)
    setEditingTask(null)
  }

  // Only block on the first load. Subsequent refetches happen in the
  // background so an open TaskForm dialog stays mounted on alt-tab.
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Task Management</h1>
          <p className="text-muted-foreground">
            Manage all tasks across the organization
          </p>
        </div>
        <Button onClick={() => setShowTaskForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks by title, description, or users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <Select value={selectedUser || "all"} onValueChange={(value) => setSelectedUser(value === "all" ? "" : value)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filter by user" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={user.image || undefined} />
                    <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-medium text-xs">
                      {user.name
                        ? user.name.split(' ').map(n => n[0]).join('')
                        : user.email?.[0]?.toUpperCase()
                      }
                    </AvatarFallback>
                  </Avatar>
                  <span>{user.name || user.email}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(selectedUser || searchTerm || statusFilter) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedUser('')
              setSearchTerm('')
              setStatusFilter('')
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Status Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(COLUMN_CONFIG).map(([status, config]) => {
          const count = tasks.filter(t => t.status === status).length
          const isActive = statusFilter === status
          const dotColor = {
            TODO: 'bg-gray-400',
            IN_PROGRESS: 'bg-blue-500',
            IN_REVIEW: 'bg-yellow-500',
            COMPLETED: 'bg-green-500',
            CANCELLED: 'bg-red-500',
          }[status]
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(isActive ? '' : status)}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                isActive
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">{config.title}</span>
                <div className={`w-2 h-2 rounded-full ${dotColor}`} />
              </div>
              <p className={`text-2xl font-bold ${isActive ? 'text-primary' : 'text-foreground'}`}>{count}</p>
              {isActive && (
                <p className="text-xs text-primary mt-1">Click to clear</p>
              )}
            </button>
          )
        })}
      </div>

      {/* List View (when a status is selected) */}
      {statusFilter && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {COLUMN_CONFIG[statusFilter as Task['status']].title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              </span>
            </h2>
            <Button variant="outline" size="sm" onClick={() => setStatusFilter('')}>
              Show All
            </Button>
          </div>

          {tasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No {COLUMN_CONFIG[statusFilter as Task['status']].title.toLowerCase()} tasks found.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tasks.map((task) => (
                <Card
                  key={task.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedTask(task)}
                >
                  <CardContent className="p-4 space-y-3">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {getTaskTypeIcon(task.taskType)}
                        <h4 className="font-medium text-sm leading-snug truncate">{task.title}</h4>
                        {task.recurringParentId && (
                          <RefreshCw className="h-3 w-3 text-blue-500 flex-shrink-0" />
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditForm(task) }}>
                            <Edit className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={(e) => { e.stopPropagation(); setDeletingTask(task) }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {task.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                    )}

                    {/* Progress */}
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span>{task.progressPercentage || 0}%</span>
                      </div>
                      <Progress value={task.progressPercentage || 0} className="h-1" />
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`w-2 h-2 rounded-full ${getPriorityColor(task.priority)}`} />
                      <Badge variant="outline" className="text-xs capitalize">{task.taskType.toLowerCase()}</Badge>
                      {task.team && <Badge variant="secondary" className="text-xs">{task.team.name}</Badge>}
                      {task.dueDate && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                          <Clock className="h-3 w-3" />
                          {format(new Date(task.dueDate), 'MMM dd')}
                        </span>
                      )}
                    </div>

                    {/* Assignee */}
                    {task.assignee && (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={task.assignee.image || undefined} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                            {task.assignee.name?.split(' ').map(n => n[0]).join('') ?? task.assignee.email[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground truncate">
                          {task.assignee.name || task.assignee.email}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Kanban Board (shown when no status filter active) */}
      {!statusFilter && (
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6 min-h-[600px]">
          {Object.entries(COLUMN_CONFIG).map(([status, config]) => {
            const columnTasks = getTasksByStatus(status as Task['status'])
            
            return (
              <div key={status} className="space-y-4">
                <div className={`p-3 rounded-lg ${config.color}`}>
                  <h3 className={`font-semibold ${config.textColor} flex items-center justify-between`}>
                    {config.title}
                    <Badge variant="secondary" className="ml-2">
                      {columnTasks.length}
                    </Badge>
                  </h3>
                </div>

                <Droppable droppableId={status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`space-y-3 min-h-[500px] p-2 rounded-lg transition-colors ${
                        snapshot.isDraggingOver ? 'bg-muted/30' : ''
                      }`}
                    >
                      {columnTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <Card
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`cursor-pointer hover:cursor-grab active:cursor-grabbing transition-shadow ${
                                snapshot.isDragging ? 'shadow-lg rotate-2' : 'hover:shadow-md'
                              }`}
                              onClick={(e) => {
                                if (!snapshot.isDragging) {
                                  setSelectedTask(task)
                                }
                              }}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex items-start gap-2 flex-1">
                                    <div className="flex items-center gap-1 flex-1">
                                      {getTaskTypeIcon(task.taskType)}
                                      <h4 className="font-medium text-sm leading-tight flex-1">
                                        {task.title}
                                      </h4>
                                      {task.recurringParentId && (
                                        <RefreshCw className="h-3 w-3 text-blue-500 flex-shrink-0" />
                                      )}
                                    </div>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        openEditForm(task)
                                      }}>
                                        <Edit className="h-4 w-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                                        <Eye className="h-4 w-4 mr-2" />
                                        View Details
                                      </DropdownMenuItem>
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
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>

                                {task.description && (
                                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                                    {task.description}
                                  </p>
                                )}

                                <div className="mb-3">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-muted-foreground">Progress</span>
                                    <span className="text-xs font-medium">{task.progressPercentage || 0}%</span>
                                  </div>
                                  <Progress 
                                    value={task.progressPercentage || 0} 
                                    className="h-1"
                                  />
                                </div>

                                <div className="flex items-center gap-2 mb-3">
                                  <div className={`w-2 h-2 rounded-full ${getPriorityColor(task.priority)}`} />
                                  <Badge variant="outline" className="text-xs capitalize">
                                    {task.taskType.toLowerCase()}
                                  </Badge>
                                  {task.team && (
                                    <Badge variant="secondary" className="text-xs">
                                      {task.team.name}
                                    </Badge>
                                  )}
                                </div>

                                {task.dueDate && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                                    <Clock className="h-3 w-3" />
                                    {format(new Date(task.dueDate), 'MMM dd')}
                                  </div>
                                )}

                                <div className="space-y-2">
                                  {task.assignee && (
                                    <div className="flex items-center gap-2">
                                      <Avatar className="h-5 w-5">
                                        <AvatarImage src={task.assignee.image || undefined} />
                                        <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-medium text-xs">
                                          {task.assignee.name ? 
                                            task.assignee.name.split(' ').map(n => n[0]).join('') : 
                                            task.assignee.email[0].toUpperCase()
                                          }
                                        </AvatarFallback>
                                      </Avatar>
                                      <span className="text-xs text-muted-foreground truncate">
                                        {task.assignee.name || task.assignee.email}
                                      </span>
                                    </div>
                                  )}

                                  {task.teamMembers && task.teamMembers.length > 0 && (
                                    <div className="flex items-center gap-1">
                                      <Users className="h-3 w-3 text-muted-foreground" />
                                      <div className="flex -space-x-1">
                                        {task.teamMembers.slice(0, 3).map((member) => (
                                          <Avatar key={member.userId} className="h-4 w-4 border border-background">
                                            <AvatarImage src={member.user.image || undefined} />
                                            <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-medium text-xs">
                                              {member.user.name ? 
                                                member.user.name.split(' ').map(n => n[0]).join('') : 
                                                member.user.email?.[0]?.toUpperCase()
                                              }
                                            </AvatarFallback>
                                          </Avatar>
                                        ))}
                                        {task.teamMembers.length > 3 && (
                                          <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center border border-background">
                                            <span className="text-xs">+{task.teamMembers.length - 3}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {task.collaborators && task.collaborators.length > 0 && (
                                    <div className="flex items-center gap-1">
                                      <Handshake className="h-3 w-3 text-muted-foreground" />
                                      <div className="flex -space-x-1">
                                        {task.collaborators.slice(0, 3).map((collaborator) => (
                                          <Avatar key={collaborator.userId} className="h-4 w-4 border border-background">
                                            <AvatarImage src={collaborator.user.image || undefined} />
                                            <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-medium text-xs">
                                              {collaborator.user.name ? 
                                                collaborator.user.name.split(' ').map(n => n[0]).join('') : 
                                                collaborator.user.email?.[0]?.toUpperCase()
                                              }
                                            </AvatarFallback>
                                          </Avatar>
                                        ))}
                                        {task.collaborators.length > 3 && (
                                          <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center border border-background">
                                            <span className="text-xs">+{task.collaborators.length - 3}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </div>
      </DragDropContext>
      )}

      {/* Task View Modal */}
      <TaskViewModal
        open={!!selectedTask}
        onOpenChange={(open) => { if (!open) setSelectedTask(null) }}
        task={selectedTask as any}
        onEdit={(task) => {
          setSelectedTask(null)
          openEditForm(task as any)
        }}
        onTaskUpdate={fetchTasks}
      />

      {/* Task Form Dialog */}
      <TaskForm
        open={showTaskForm}
        onOpenChange={closeTaskForm}
        task={editingTask}
        onSubmit={editingTask ? handleUpdateTask : handleCreateTask}
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
    </div>
  )
}
