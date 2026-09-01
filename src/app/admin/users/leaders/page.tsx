'use client'

import { useState, useEffect } from 'react'
import { Crown, Shield, Users, Mail, Calendar, Search, Edit, LayoutList, LayoutGrid, User, Clock, CheckSquare, Handshake } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserRole, HierarchyLevel } from '@prisma/client'
import { format } from 'date-fns'

interface Leader {
  id: string
  email: string
  name: string
  role: UserRole
  hierarchyLevel: HierarchyLevel | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  teamMembers: Array<{
    team: {
      id: string
      name: string
    }
  }>
  _count: {
    assignedTasks: number
    createdTasks: number
  }
}

interface UserTask {
  id: string
  title: string
  description?: string
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  taskType: 'INDIVIDUAL' | 'TEAM' | 'COLLABORATION'
  progressPercentage: number
  dueDate?: string
  team?: { id: string; name: string }
}

const TASK_STATUS_CONFIG = {
  TODO:        { label: 'To Do',       dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-700' },
  IN_PROGRESS: { label: 'In Progress', dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-700' },
  IN_REVIEW:   { label: 'In Review',   dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700' },
  COMPLETED:   { label: 'Completed',   dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700' },
  CANCELLED:   { label: 'Cancelled',   dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700' },
} as const

export default function AdminLeadersPage() {
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'column' | 'grid'>('grid')
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 6,
    total: 0,
    totalPages: 0
  })

  // Edit modal state
  const [editingLeader, setEditingLeader] = useState<Leader | null>(null)

  // Task modal state
  const [selectedLeader, setSelectedLeader] = useState<Leader | null>(null)
  const [userTasks, setUserTasks] = useState<UserTask[]>([])
  const [userTasksLoading, setUserTasksLoading] = useState(false)
  const [activeTaskStatus, setActiveTaskStatus] = useState<string>('')

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const fetchLeaders = async () => {
    try {
      const params = new URLSearchParams({
        role: 'LEADER',
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(debouncedSearchTerm && { search: debouncedSearchTerm })
      })

      const response = await fetch(`/api/admin/users?${params}`)
      const data = await response.json()

      if (response.ok) {
        setLeaders(data.users)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching leaders:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLeaders()
  }, [pagination.page, debouncedSearchTerm])

  const fetchUserTasks = async (userId: string) => {
    setUserTasksLoading(true)
    setUserTasks([])
    try {
      const response = await fetch(`/api/admin/users/tasks?assigneeId=${userId}&limit=500`)
      if (response.ok) {
        const data = await response.json()
        setUserTasks(data.tasks || [])
      }
    } catch (error) {
      console.error('Error fetching user tasks:', error)
    } finally {
      setUserTasksLoading(false)
    }
  }

  const openTaskModal = (leader: Leader) => {
    setSelectedLeader(leader)
    setActiveTaskStatus('')
    fetchUserTasks(leader.id)
  }

  const handleUpdateLeader = async () => {
    if (!editingLeader) return
    try {
      const response = await fetch(`/api/admin/users/${editingLeader.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingLeader.name,
          role: editingLeader.role,
          hierarchyLevel: editingLeader.hierarchyLevel || undefined,
          isActive: editingLeader.isActive,
        })
      })
      if (response.ok) {
        setEditingLeader(null)
        fetchLeaders()
      }
    } catch (error) {
      console.error('Error updating leader:', error)
    }
  }

  const getHierarchyColor = (level: HierarchyLevel | null) => {
    if (!level) return 'bg-slate-50 text-slate-700 border border-slate-200'
    const hierarchyOrder = ['RF1', 'RF2', 'RF3', 'OF1', 'OF2', 'M1', 'M2']
    const index = hierarchyOrder.indexOf(level)
    const colors = [
      'bg-slate-50 text-slate-700 border border-slate-200',
      'bg-amber-50 text-amber-700 border border-amber-200',
      'bg-orange-50 text-orange-700 border border-orange-200',
      'bg-blue-50 text-blue-700 border border-blue-200',
      'bg-indigo-50 text-indigo-700 border border-indigo-200',
      'bg-purple-50 text-purple-700 border border-purple-200',
      'bg-pink-50 text-pink-700 border border-pink-200'
    ]
    return colors[index] || colors[0]
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
          <h1 className="text-2xl font-semibold text-slate-900">Leaders Management</h1>
          <p className="text-sm font-medium text-slate-600">Manage all team leaders and their responsibilities</p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge className="bg-blue-50 text-blue-700 border border-blue-200 rounded-md px-2.5 py-0.5 text-xs font-medium">
            {pagination.total} Leaders
          </Badge>
        </div>
      </div>

      {/* Search and View Toggle */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search leaders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center border border-slate-200 rounded-lg p-1">
          <Button
            variant={viewMode === 'column' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('column')}
            className="h-8 w-8 p-0"
          >
            <LayoutList className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 p-0"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Crown className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-slate-600">Total Leaders</p>
              <p className="text-2xl font-semibold text-slate-900">{pagination.total}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <Users className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-slate-600">Active Leaders</p>
              <p className="text-2xl font-semibold text-slate-900">
                {leaders.filter(l => l.isActive).length}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Shield className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-slate-600">M1+ Level</p>
              <p className="text-2xl font-semibold text-slate-900">
                {leaders.filter(l => l.hierarchyLevel && ['M1', 'M2'].includes(l.hierarchyLevel)).length}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-amber-50 rounded-lg">
              <Calendar className="h-6 w-6 text-amber-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-slate-600">Teams Led</p>
              <p className="text-2xl font-semibold text-slate-900">
                {leaders.reduce((acc, l) => acc + l.teamMembers.length, 0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Leaders List */}
      <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'grid gap-4'}>
        {leaders.map((leader) => (
          <Card
            key={leader.id}
            className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => openTaskModal(leader)}
          >
            {viewMode === 'grid' ? (
              // Grid View - Compact vertical layout
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-16 w-16 rounded-lg ring-2 ring-slate-200 mb-3">
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 font-semibold text-lg">
                    {leader.name ? leader.name.split(' ').map(n => n[0]).join('') : 'L'}
                  </AvatarFallback>
                </Avatar>
                <h3 className="font-semibold text-slate-900 mb-1">{leader.name}</h3>
                <div className="flex items-center justify-center text-sm font-medium text-slate-600 mb-2">
                  <Mail className="w-4 h-4 mr-1" />
                  <span className="truncate max-w-[180px]">{leader.email}</span>
                </div>
                <div className="flex items-center justify-center flex-wrap gap-1 mb-3">
                  <Badge className="bg-blue-50 text-blue-700 border border-blue-200 rounded-md px-2 py-0.5 text-xs font-medium">
                    <Shield className="w-3 h-3 mr-1" />
                    {leader.role}
                  </Badge>
                  {leader.hierarchyLevel ? (
                    <Badge className={`${getHierarchyColor(leader.hierarchyLevel)} rounded-md px-2 py-0.5 text-xs font-medium`}>
                      {leader.hierarchyLevel}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-md px-2 py-0.5 text-xs font-medium border-slate-200">
                      No Hierarchy
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-center gap-4 text-sm text-gray-600 mb-3">
                  <div className="text-center">
                    <div className="font-medium text-gray-900">{leader.teamMembers.length}</div>
                    <div className="text-xs">Teams</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium text-gray-900">{leader._count.assignedTasks}</div>
                    <div className="text-xs">Tasks</div>
                  </div>
                </div>
                <Badge variant={leader.isActive ? "default" : "secondary"} className="rounded-md px-2.5 py-0.5 text-xs font-medium mb-3">
                  {leader.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setEditingLeader(leader) }}
                  className="w-full"
                >
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>

                {/* Teams Led */}
                {leader.teamMembers.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 w-full">
                    <p className="text-xs font-medium text-gray-700 mb-1">Teams:</p>
                    <div className="flex flex-wrap justify-center gap-1">
                      {leader.teamMembers.slice(0, 2).map((tm, index) => (
                        <Badge key={index} variant="outline" className="bg-gray-50 text-xs">
                          {tm.team.name}
                        </Badge>
                      ))}
                      {leader.teamMembers.length > 2 && (
                        <Badge variant="outline" className="bg-gray-50 text-xs">
                          +{leader.teamMembers.length - 2}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // Column View - Horizontal layout
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Avatar className="h-12 w-12 rounded-lg ring-2 ring-slate-200">
                      <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 font-semibold">
                        {leader.name ? leader.name.split(' ').map(n => n[0]).join('') : 'L'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold text-slate-900">{leader.name}</h3>
                      <div className="flex items-center space-x-2 text-sm font-medium text-slate-600">
                        <Mail className="w-4 h-4" />
                        <span>{leader.email}</span>
                      </div>
                      <div className="flex items-center space-x-2 mt-1">
                        <Badge className="bg-blue-50 text-blue-700 border border-blue-200 rounded-md px-2.5 py-0.5 text-xs font-medium">
                          <Shield className="w-3 h-3 mr-1" />
                          {leader.role}
                        </Badge>
                        {leader.hierarchyLevel ? (
                          <Badge className={`${getHierarchyColor(leader.hierarchyLevel)} rounded-md px-2.5 py-0.5 text-xs font-medium`}>
                            {leader.hierarchyLevel}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-md px-2.5 py-0.5 text-xs font-medium border-slate-200">
                            No Hierarchy
                          </Badge>
                        )}
                        <Badge variant={leader.isActive ? "default" : "secondary"} className="rounded-md px-2.5 py-0.5 text-xs font-medium">
                          {leader.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6 text-sm text-gray-600">
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{leader.teamMembers.length}</div>
                      <div>Teams</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{leader._count.assignedTasks}</div>
                      <div>Tasks</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">
                        {new Date(leader.createdAt).toLocaleDateString()}
                      </div>
                      <div>Joined</div>
                    </div>

                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setEditingLeader(leader) }}
                      >
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Teams Led */}
                {leader.teamMembers.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm font-medium text-gray-700 mb-2">Teams Leading:</p>
                    <div className="flex flex-wrap gap-2">
                      {leader.teamMembers.map((tm, index) => (
                        <Badge key={index} variant="outline" className="bg-gray-50">
                          {tm.team.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
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

      {leaders.length === 0 && !loading && (
        <div className="text-center py-12">
          <Crown className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No leaders found</h3>
          <p className="mt-1 text-sm text-gray-500">
            There are no leaders in the system yet.
          </p>
        </div>
      )}

      {/* Edit Leader Dialog */}
      <Dialog open={!!editingLeader} onOpenChange={(open) => { if (!open) setEditingLeader(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Leader: {editingLeader?.name}</DialogTitle>
            <DialogDescription>Update leader information, role, and hierarchy level.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                value={editingLeader?.name ?? ''}
                onChange={(e) => editingLeader && setEditingLeader({ ...editingLeader, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                value={editingLeader?.role}
                onValueChange={(value) => editingLeader && setEditingLeader({ ...editingLeader, role: value as UserRole })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UserRole.MEMBER}>Member</SelectItem>
                  <SelectItem value={UserRole.LEADER}>Leader</SelectItem>
                  <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-hierarchy">Hierarchy Level</Label>
              <Select
                value={editingLeader?.hierarchyLevel ?? HierarchyLevel.RF1}
                onValueChange={(value) => editingLeader && setEditingLeader({ ...editingLeader, hierarchyLevel: value as HierarchyLevel })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HierarchyLevel.RF1}>RF1 (Entry Level)</SelectItem>
                  <SelectItem value={HierarchyLevel.RF2}>RF2</SelectItem>
                  <SelectItem value={HierarchyLevel.RF3}>RF3</SelectItem>
                  <SelectItem value={HierarchyLevel.OF1}>OF1</SelectItem>
                  <SelectItem value={HierarchyLevel.OF2}>OF2</SelectItem>
                  <SelectItem value={HierarchyLevel.M1}>M1</SelectItem>
                  <SelectItem value={HierarchyLevel.M2}>M2 (Senior Level)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLeader(null)}>Cancel</Button>
            <Button onClick={handleUpdateLeader}>Update Leader</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Modal */}
      <Dialog
        open={!!selectedLeader}
        onOpenChange={(open) => { if (!open) { setSelectedLeader(null); setUserTasks([]) } }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 sm:p-0 gap-0">
          {/* Header */}
          <div className="px-6 pr-14 pt-6 pb-4 border-b">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 rounded-xl ring-2 ring-slate-200">
                <AvatarFallback className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 font-bold text-lg">
                  {selectedLeader?.name?.split(' ').map(n => n[0]).join('') ?? 'L'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-semibold text-slate-900 truncate">
                  {selectedLeader?.name}
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500 truncate">
                  {selectedLeader?.email} · {userTasks.length} task{userTasks.length !== 1 ? 's' : ''} total
                </DialogDescription>
              </div>
            </div>

            {/* Status tabs */}
            <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveTaskStatus('')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  activeTaskStatus === ''
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                All ({userTasks.length})
              </button>
              {(Object.keys(TASK_STATUS_CONFIG) as Array<keyof typeof TASK_STATUS_CONFIG>).map((s) => {
                const count = userTasks.filter(t => t.status === s).length
                if (count === 0) return null
                const cfg = TASK_STATUS_CONFIG[s]
                return (
                  <button
                    key={s}
                    onClick={() => setActiveTaskStatus(s)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      activeTaskStatus === s
                        ? `${cfg.badge} border-current`
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label} ({count})
                  </button>
                )
              })}
            </div>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {userTasksLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : (() => {
              const filtered = activeTaskStatus
                ? userTasks.filter(t => t.status === activeTaskStatus)
                : userTasks
              if (filtered.length === 0) return (
                <div className="text-center py-12 text-slate-400">
                  <CheckSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No tasks found</p>
                </div>
              )
              return (
                <div className="space-y-2">
                  {filtered.map((task) => {
                    const cfg = TASK_STATUS_CONFIG[task.status] ?? TASK_STATUS_CONFIG.TODO
                    const priorityDot: Record<string, string> = {
                      URGENT: 'bg-red-500', HIGH: 'bg-orange-500',
                      MEDIUM: 'bg-yellow-400', LOW: 'bg-green-500',
                    }
                    const typeIcon = task.taskType === 'TEAM'
                      ? <Users className="h-3.5 w-3.5 text-slate-400" />
                      : task.taskType === 'COLLABORATION'
                      ? <Handshake className="h-3.5 w-3.5 text-slate-400" />
                      : <User className="h-3.5 w-3.5 text-slate-400" />
                    return (
                      <div key={task.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            {typeIcon}
                            <p className="text-sm font-medium text-slate-800 truncate">{task.title}</p>
                          </div>
                          {task.description && (
                            <p className="text-xs text-slate-400 line-clamp-1 mb-2">{task.description}</p>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[task.priority] ?? 'bg-gray-400'}`} />
                              {task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}
                            </span>
                            {task.team && (
                              <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                {task.team.name}
                              </span>
                            )}
                            {task.dueDate && (
                              <span className="flex items-center gap-1 text-xs text-slate-400 ml-auto">
                                <Clock className="h-3 w-3" />
                                {format(new Date(task.dueDate), 'MMM d')}
                              </span>
                            )}
                          </div>
                          {task.progressPercentage > 0 && (
                            <div className="mt-2">
                              <Progress value={task.progressPercentage} className="h-1" />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
