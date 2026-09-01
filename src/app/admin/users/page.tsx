'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, Filter, Edit, Trash2, User, Mail, Calendar, Shield, Crown, LayoutList, LayoutGrid, KeyRound, Copy, Check, Clock, CheckSquare, X, Users, Handshake, Download, Eye, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { format } from 'date-fns'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import { UserRole, HierarchyLevel } from '@prisma/client'
import { BulkUserActionsDialog } from '@/components/admin/bulk-user-actions-dialog'

interface User {
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

interface OrganizationalUnit {
  id: string
  name: string
  code?: string
  unitType: string
  level: number
  parentId?: string
  path: string
  metadata?: any
  isActive: boolean
  allowsCustomInput?: boolean
  requiresCode?: boolean
  requiresSectionInput?: boolean
  requiresTeamLabel?: boolean
  requiresSectorHead?: boolean
  disabled?: boolean
  children?: OrganizationalUnit[]
}

interface Leader {
  id: string
  firstName: string | null
  lastName: string | null
  name: string
  email: string
  role: string
}

interface SectorHead {
  id: string
  initials: string
  fullName: string
  label: string
}

interface CreateUserData {
  firstName: string
  lastName: string
  middleName: string
  email: string
  username: string
  contactNumber: string
  role: string
  hierarchyLevel: string
  reportsToId: string
  division: string
  department: string
  section: string
  team: string
  positionTitle: string
  shortName: string
  jobLevel: string
  isLeader: boolean
  image: string
  password: string
  organizationalPath: string
  sectorHeadInitials: string
  customDivision: string
  customDepartment: string
  customSection: string
  customTeam: string
}

interface UpdateUserData {
  name?: string
  role?: UserRole
  hierarchyLevel?: HierarchyLevel
  isActive?: boolean
  password?: string
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

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [hierarchyFilter, setHierarchyFilter] = useState<HierarchyLevel | 'all'>('all')
  const [viewMode, setViewMode] = useState<'column' | 'grid'>('grid')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [resetLinkInfo, setResetLinkInfo] = useState<{ url: string; email: string; expiresAt: string } | null>(null)
  const [resetLinkCopied, setResetLinkCopied] = useState(false)

  const handleSendResetLink = async (user: { id: string; email: string; name: string }) => {
    if (!confirm(`Generate a one-time password reset link for ${user.name || user.email}? Any prior unused link will be invalidated.`)) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-link`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? 'Failed to create reset link')
        return
      }
      setResetLinkInfo({ url: data.resetUrl, email: data.target.email, expiresAt: data.expiresAt })
      setResetLinkCopied(false)
    } catch {
      alert('Network error generating reset link')
    }
  }
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 9,
    total: 0,
    totalPages: 0
  })

  // User task modal state
  const [selectedUserForTasks, setSelectedUserForTasks] = useState<User | null>(null)
  const [userTasks, setUserTasks] = useState<UserTask[]>([])
  const [userTasksLoading, setUserTasksLoading] = useState(false)
  const [activeTaskStatus, setActiveTaskStatus] = useState<string>('')

  // Password reset state
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null)
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [showPasswordResult, setShowPasswordResult] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resettingPassword, setResettingPassword] = useState(false)

  // Dynamic form state from registration form
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [sectorHeads, setSectorHeads] = useState<SectorHead[]>([])
  
  // Organizational structure state
  const [divisions, setDivisions] = useState<OrganizationalUnit[]>([])
  const [selectedDivision, setSelectedDivision] = useState<OrganizationalUnit | null>(null)
  const [departments, setDepartments] = useState<OrganizationalUnit[]>([])
  const [selectedDepartment, setSelectedDepartment] = useState<OrganizationalUnit | null>(null)
  const [sections, setSections] = useState<OrganizationalUnit[]>([])
  const [selectedSection, setSelectedSection] = useState<OrganizationalUnit | null>(null)
  const [jobLevels, setJobLevels] = useState<Array<{name: string; description: string | null; order: number}>>([])
  const [teams, setTeams] = useState<Array<{id: string; name: string; code?: string; type: string}>>([])
  const [selectedTeam, setSelectedTeam] = useState<{id: string; name: string; code?: string; type: string} | null>(null)

  // UI state for custom inputs
  const [showCustomDivisionInput, setShowCustomDivisionInput] = useState(false)
  const [showCustomDepartmentInput, setShowCustomDepartmentInput] = useState(false)
  const [showCustomSectionInput, setShowCustomSectionInput] = useState(false)
  const [showCustomTeamInput, setShowCustomTeamInput] = useState(false)
  const [showSectorHeadInput, setShowSectorHeadInput] = useState(false)

  const [newUser, setNewUser] = useState<CreateUserData>({
    firstName: '',
    lastName: '',
    middleName: '',
    email: '',
    username: '',
    contactNumber: '',
    role: 'MEMBER',
    hierarchyLevel: 'RF1',
    reportsToId: '',
    division: '',
    department: '',
    section: '',
    team: '',
    positionTitle: '',
    shortName: '',
    jobLevel: '',
    isLeader: false,
    image: '',
    password: '',
    organizationalPath: '',
    sectorHeadInitials: '',
    customDivision: '',
    customDepartment: '',
    customSection: '',
    customTeam: ''
  })

  // Debounce search term to avoid refetching on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 500) // Wait 500ms after user stops typing

    return () => clearTimeout(timer)
  }, [searchTerm])

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(debouncedSearchTerm && { search: debouncedSearchTerm }),
        ...(roleFilter !== 'all' && { role: roleFilter }),
        ...(hierarchyFilter !== 'all' && { hierarchyLevel: hierarchyFilter })
      })

      const response = await fetch(`/api/admin/users?${params}`)
      const data = await response.json()

      if (response.ok) {
        setUsers(data.users)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [pagination.page, debouncedSearchTerm, roleFilter, hierarchyFilter])

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

  const openUserTasksModal = (user: User) => {
    setSelectedUserForTasks(user)
    setActiveTaskStatus('')
    fetchUserTasks(user.id)
  }

  // Fetch organizational data on component mount (copied from registration form)
  useEffect(() => {
    const fetchDivisions = async () => {
      try {
        const response = await fetch('/api/organizational-units?level=1&includeInactive=true')
        if (response.ok) {
          const data = await response.json()
          setDivisions(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching divisions:', error)
      }
    }

    const fetchJobLevels = async () => {
      try {
        const response = await fetch('/api/job-levels?includeInactive=true')
        if (response.ok) {
          const data = await response.json()
          setJobLevels(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching job levels:', error)
      }
    }

    const fetchSectorHeads = async () => {
      try {
        const response = await fetch('/api/sector-heads?includeInactive=true')
        if (response.ok) {
          const data = await response.json()
          setSectorHeads(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching sector heads:', error)
      }
    }

    fetchDivisions()
    fetchJobLevels()
    fetchSectorHeads()
  }, [])

  // Fetch leaders for dropdown
  useEffect(() => {
    const fetchLeaders = async () => {
      try {
        const response = await fetch('/api/users/leaders?includeAdmins=true&includeInactive=false')
        if (response.ok) {
          const data = await response.json()
          setLeaders(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching leaders:', error)
      }
    }

    fetchLeaders()
  }, [])

  // Handler functions from registration form
  const handleInputChange = (field: keyof CreateUserData, value: any) => {
    setNewUser(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleLeaderCheckboxChange = (checked: boolean) => {
    setNewUser(prev => ({
      ...prev,
      isLeader: checked,
      role: checked ? 'LEADER' : 'MEMBER',
      reportsToId: checked ? '' : prev.reportsToId // Clear reportsTo if becoming leader
    }))
  }

  // Handle division selection
  const handleDivisionChange = async (divisionId: string) => {
    const division = divisions.find(d => d.id === divisionId)
    if (!division) return

    setSelectedDivision(division)
    setSelectedDepartment(null)
    setSelectedSection(null)
    setDepartments([])
    setSections([])
    
    // Reset dependent form fields
    setNewUser(prev => ({
      ...prev,
      division: division.name,
      department: '',
      section: '',
      team: '',
      customDepartment: '',
      customSection: '',
      customTeam: '',
      organizationalPath: division.name
    }))

    // Handle special cases
    if (division.name === 'Other') {
      setShowCustomDivisionInput(true)
      return
    } else {
      setShowCustomDivisionInput(false)
    }

    if (division.requiresSectorHead) {
      setShowSectorHeadInput(true)
    } else {
      setShowSectorHeadInput(false)
    }

    // Fetch children if available
    if (division.children && division.children.length > 0) {
      setDepartments(division.children)
    } else {
      try {
        const response = await fetch(`/api/organizational-units?parentId=${divisionId}&includeInactive=true`)
        if (response.ok) {
          const data = await response.json()
          setDepartments(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching departments:', error)
      }
    }
  }

  // Handle department selection
  const handleDepartmentChange = async (departmentId: string) => {
    const department = departments.find(d => d.id === departmentId)
    if (!department) return

    setSelectedDepartment(department)
    setSelectedSection(null)
    setSections([])

    // Reset dependent form fields
    setNewUser(prev => ({
      ...prev,
      department: department.name,
      section: '',
      team: '',
      customSection: '',
      customTeam: '',
      organizationalPath: `${prev.division}/${department.name}`
    }))

    // Reset custom input states
    setShowCustomDepartmentInput(false)
    setShowCustomSectionInput(false)
    setShowCustomTeamInput(false)

    // Handle special cases based on department properties
    if (department.allowsCustomInput && department.name === 'Other') {
      setShowCustomDepartmentInput(true)
    }

    // For Real Property departments (ETII, ECLI, KPPI) that have sections
    if (department.children && department.children.length > 0) {
      setSections(department.children)
    } 
    // For Shared Services departments that require section input
    else if (department.requiresSectionInput) {
      setShowCustomSectionInput(true)
    }
    // For departments that require team label directly (Hotel Operations, etc.)
    else if (department.requiresTeamLabel) {
      setShowCustomTeamInput(true)
    }
  }

  // Handle section selection
  const handleSectionChange = (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return

    setSelectedSection(section)
    
    setNewUser(prev => ({
      ...prev,
      section: section.name,
      team: '',
      customTeam: '',
      organizationalPath: `${prev.division}/${prev.department}/${section.name}`
    }))

    // Fetch teams for this section
    fetchTeamsForSection(sectionId, section.name)
  }

  // Fetch teams for a specific section
  const fetchTeamsForSection = async (sectionId: string, sectionName: string) => {
    try {
      const response = await fetch(`/api/teams-data?sectionId=${sectionId}&sectionName=${encodeURIComponent(sectionName)}&includeInactive=true`)
      if (response.ok) {
        const data = await response.json()
        setTeams(data.data || [])
        if (data.data && data.data.length > 0) {
          setShowCustomTeamInput(false) // Hide custom input if teams are available
        } else {
          setShowCustomTeamInput(true) // Show custom input if no predefined teams
        }
      }
    } catch (error) {
      console.error('Error fetching teams for section:', error)
      setShowCustomTeamInput(true) // Fallback to custom input
    }
  }

  const handleCreateUser = async () => {
    try {
      // Clean up the user data to handle empty strings and foreign key constraints
      const cleanedUserData = {
        ...newUser,
        reportsToId: newUser.reportsToId === '' ? null : newUser.reportsToId,
        username: newUser.username === '' ? null : newUser.username,
        contactNumber: newUser.contactNumber === '' ? null : newUser.contactNumber,
        middleName: newUser.middleName === '' ? null : newUser.middleName,
        positionTitle: newUser.positionTitle === '' ? null : newUser.positionTitle,
        shortName: newUser.shortName === '' ? null : newUser.shortName,
        jobLevel: newUser.jobLevel === '' ? null : newUser.jobLevel,
        division: newUser.division === '' ? null : newUser.division,
        department: newUser.department === '' ? null : newUser.department,
        section: newUser.section === '' ? null : newUser.section,
        team: newUser.team === '' ? null : newUser.team,
        image: newUser.image === '' ? null : newUser.image,
        organizationalPath: newUser.organizationalPath === '' ? null : newUser.organizationalPath,
        sectorHeadInitials: newUser.sectorHeadInitials === '' ? null : newUser.sectorHeadInitials,
        customDivision: newUser.customDivision === '' ? null : newUser.customDivision,
        customDepartment: newUser.customDepartment === '' ? null : newUser.customDepartment,
        customSection: newUser.customSection === '' ? null : newUser.customSection,
        customTeam: newUser.customTeam === '' ? null : newUser.customTeam
      }

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedUserData)
      })

      if (response.ok) {
        setIsCreateDialogOpen(false)
        setNewUser({
          firstName: '',
          lastName: '',
          middleName: '',
          email: '',
          username: '',
          contactNumber: '',
          role: 'MEMBER',
          hierarchyLevel: 'RF1',
          reportsToId: '',
          division: '',
          department: '',
          section: '',
          team: '',
          positionTitle: '',
          shortName: '',
          jobLevel: '',
          isLeader: false,
          image: '',
          password: '',
          organizationalPath: '',
          sectorHeadInitials: '',
          customDivision: '',
          customDepartment: '',
          customSection: '',
          customTeam: ''
        })
        // Reset organizational state
        setSelectedDivision(null)
        setSelectedDepartment(null)
        setSelectedSection(null)
        setSelectedTeam(null)
        setDepartments([])
        setSections([])
        setTeams([])
        setShowCustomDivisionInput(false)
        setShowCustomDepartmentInput(false)
        setShowCustomSectionInput(false)
        setShowCustomTeamInput(false)
        setShowSectorHeadInput(false)
        fetchUsers()
      }
    } catch (error) {
      console.error('Error creating user:', error)
    }
  }

  const handleUpdateUser = async (userId: string, updateData: UpdateUserData) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (response.ok) {
        fetchUsers()
        setEditingUser(null)
      }
    } catch (error) {
      console.error('Error updating user:', error)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        fetchUsers()
      }
    } catch (error) {
      console.error('Error deleting user:', error)
    }
  }

  const generateRandomPassword = (): string => {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lower = 'abcdefghijklmnopqrstuvwxyz'
    const digits = '0123456789'
    const special = '!@#$%&*'
    const all = upper + lower + digits + special

    // Guarantee at least one of each type
    let password = ''
    password += upper[Math.floor(Math.random() * upper.length)]
    password += lower[Math.floor(Math.random() * lower.length)]
    password += digits[Math.floor(Math.random() * digits.length)]
    password += special[Math.floor(Math.random() * special.length)]

    // Fill remaining characters
    for (let i = 4; i < 12; i++) {
      password += all[Math.floor(Math.random() * all.length)]
    }

    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('')
  }

  const handleResetPassword = async () => {
    if (!resetPasswordUser) return
    setResettingPassword(true)
    try {
      const newPassword = generateRandomPassword()
      const response = await fetch(`/api/admin/users/${resetPasswordUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword })
      })

      if (response.ok) {
        setGeneratedPassword(newPassword)
        setResetPasswordUser(null)
        setShowPasswordResult(true)
        setCopied(false)
      }
    } catch (error) {
      console.error('Error resetting password:', error)
    } finally {
      setResettingPassword(false)
    }
  }

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy password:', error)
    }
  }

  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case UserRole.ADMIN: return 'bg-red-50 text-red-700 border border-red-200'
      case UserRole.LEADER: return 'bg-blue-50 text-blue-700 border border-blue-200'
      case UserRole.MEMBER: return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      default: return 'bg-slate-50 text-slate-700 border border-slate-200'
    }
  }

  const getHierarchyColor = (level: HierarchyLevel) => {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">User Management</h1>
          <p className="text-sm font-medium text-slate-600">Manage system users, roles, and hierarchy levels</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkDialogOpen(true)}>
            <Users className="w-4 h-4 mr-2" />
            Bulk actions
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams()
              if (debouncedSearchTerm) params.set('search', debouncedSearchTerm)
              if (roleFilter && roleFilter !== 'all') params.set('role', roleFilter)
              if (hierarchyFilter && hierarchyFilter !== 'all') params.set('hierarchyLevel', hierarchyFilter)
              const qs = params.toString()
              window.location.href = `/api/admin/users/export${qs ? `?${qs}` : ''}`
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700 shadow-sm">
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Add a new user to the system with specified role and hierarchy level.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
              {/* Personal Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    placeholder="Enter first name"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    placeholder="Enter last name"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="middleName">Middle Name</Label>
                  <Input
                    id="middleName"
                    value={newUser.middleName || ''}
                    onChange={(e) => setNewUser({ ...newUser, middleName: e.target.value })}
                    placeholder="Enter middle name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={newUser.username || ''}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder="Enter username"
                  />
                </div>
              </div>
              
              {/* Contact Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="Enter email address"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contactNumber">Contact Number</Label>
                  <Input
                    id="contactNumber"
                    type="tel"
                    value={newUser.contactNumber || ''}
                    onChange={(e) => setNewUser({ ...newUser, contactNumber: e.target.value })}
                    placeholder="Enter contact number"
                  />
                </div>
              </div>
              
              {/* Password */}
              <div className="grid gap-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Enter password"
                  required
                />
              </div>
              
              {/* Position Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="positionTitle">Position Title</Label>
                  <Input
                    id="positionTitle"
                    value={newUser.positionTitle || ''}
                    onChange={(e) => setNewUser({ ...newUser, positionTitle: e.target.value })}
                    placeholder="Enter position title"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shortName">Short Name</Label>
                  <Input
                    id="shortName"
                    value={newUser.shortName || ''}
                    onChange={(e) => setNewUser({ ...newUser, shortName: e.target.value })}
                    placeholder="Enter short name"
                  />
                </div>
              </div>
              
              {/* Leadership Checkbox */}
              <div className="flex items-center space-x-2 p-4 border rounded-lg">
                <Checkbox
                  id="isLeader"
                  checked={newUser.isLeader}
                  onCheckedChange={handleLeaderCheckboxChange}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="isLeader"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                  >
                    <Crown className="w-4 h-4" />
                    Click if Leader
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Check this box if you are registering as a team leader
                  </p>
                </div>
              </div>

              {/* Reports To - Only show if not leader */}
              {!newUser.isLeader && (
                <div className="space-y-2">
                  <Label htmlFor="reportsTo">Reports To (Leader)</Label>
                  <Select value={newUser.reportsToId} onValueChange={(value) => handleInputChange('reportsToId', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select your leader (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {leaders.map((leader) => (
                        <SelectItem key={leader.id} value={leader.id}>
                          {leader.name || `${leader.firstName} ${leader.lastName}`.trim()} ({leader.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Organizational Structure */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Organizational Structure</h3>
                
                {/* Division Dropdown */}
                <div className="space-y-2">
                  <Label htmlFor="division">Division *</Label>
                  <Select value={selectedDivision?.id || ''} onValueChange={handleDivisionChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select division" />
                    </SelectTrigger>
                    <SelectContent>
                      {divisions.map((division) => (
                        <SelectItem 
                          key={division.id} 
                          value={division.id}
                          disabled={division.disabled}
                        >
                          {division.name} {division.code && `(${division.code})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Division Input */}
                {showCustomDivisionInput && (
                  <div className="space-y-2">
                    <Label htmlFor="customDivision">Custom Division Name</Label>
                    <Input
                      id="customDivision"
                      type="text"
                      value={newUser.customDivision}
                      onChange={(e) => handleInputChange('customDivision', e.target.value)}
                      placeholder="Enter custom division name"
                    />
                  </div>
                )}

                {/* Sector Head Dropdown (for Hotel Operations) */}
                {showSectorHeadInput && (
                  <div className="space-y-2">
                    <Label htmlFor="sectorHeadInitials">Sector Head</Label>
                    <Select 
                      value={newUser.sectorHeadInitials} 
                      onValueChange={(value) => {
                        const selectedHead = sectorHeads.find(head => head.initials === value)
                        handleInputChange('sectorHeadInitials', value)
                        if (selectedHead) {
                          console.log('Selected sector head:', selectedHead)
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select sector head" />
                      </SelectTrigger>
                      <SelectContent>
                        {sectorHeads.map((head) => (
                          <SelectItem key={head.id} value={head.initials}>
                            {head.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Department/Hotel/Service Dropdown */}
                {departments.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="department">
                      {selectedDivision?.name === 'Hotel Operations' ? 'Hotel' : 
                       selectedDivision?.name === 'Shared Services - GOLI' ? 'Service Area' :
                       selectedDivision?.name === 'CSO' ? 'Business Unit' :
                       'Department'} *
                    </Label>
                    <Select value={selectedDepartment?.id || ''} onValueChange={handleDepartmentChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((department) => (
                          <SelectItem 
                            key={department.id} 
                            value={department.id}
                            disabled={department.disabled}
                          >
                            {department.name} {department.code && `(${department.code})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Custom Department Input */}
                {showCustomDepartmentInput && (
                  <div className="space-y-2">
                    <Label htmlFor="customDepartment">Custom Department Name</Label>
                    <Input
                      id="customDepartment"
                      type="text"
                      value={newUser.customDepartment}
                      onChange={(e) => handleInputChange('customDepartment', e.target.value)}
                      placeholder="Enter custom department name"
                    />
                  </div>
                )}

                {/* Section Dropdown (for Real Property departments like ETII, ECLI, KPPI) */}
                {sections.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="section">Section *</Label>
                    <Select value={selectedSection?.id || ''} onValueChange={handleSectionChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select section" />
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((section) => (
                          <SelectItem key={section.id} value={section.id}>
                            {section.name} {section.code && `(${section.code})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Custom Section Input */}
                {showCustomSectionInput && (
                  <div className="space-y-2">
                    <Label htmlFor="customSection">Section Name</Label>
                    <Input
                      id="customSection"
                      type="text"
                      value={newUser.customSection}
                      onChange={(e) => handleInputChange('customSection', e.target.value)}
                      placeholder="Enter section name"
                    />
                  </div>
                )}

                {/* Team Dropdown/Input */}
                {(selectedDepartment || selectedSection || showCustomTeamInput) && (
                  <div className="space-y-2">
                    <Label htmlFor="team">Team</Label>
                    {teams.length > 0 ? (
                      <Select 
                        value={newUser.team} 
                        onValueChange={(value) => {
                          if (value === 'custom') {
                            setShowCustomTeamInput(true)
                            handleInputChange('team', '')
                          } else {
                            const selectedTeam = teams.find(team => team.name === value)
                            setSelectedTeam(selectedTeam || null)
                            setShowCustomTeamInput(false)
                            handleInputChange('team', value)
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select team" />
                        </SelectTrigger>
                        <SelectContent>
                          {teams.map((team) => (
                            <SelectItem key={team.id} value={team.name}>
                              {team.name} {team.code && `(${team.code})`}
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Other - Custom Team</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="team"
                        type="text"
                        value={newUser.team}
                        onChange={(e) => handleInputChange('team', e.target.value)}
                        placeholder="Enter team label (optional)"
                      />
                    )}
                  </div>
                )}

                {/* Custom Team Input */}
                {showCustomTeamInput && (
                  <div className="space-y-2">
                    <Label htmlFor="customTeam">Custom Team Name</Label>
                    <Input
                      id="customTeam"
                      type="text"
                      value={newUser.customTeam}
                      onChange={(e) => handleInputChange('customTeam', e.target.value)}
                      placeholder="Enter custom team name"
                    />
                  </div>
                )}
              </div>

              {/* Position Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="positionTitle">Position Title</Label>
                  <Input
                    id="positionTitle"
                    type="text"
                    value={newUser.positionTitle}
                    onChange={(e) => handleInputChange('positionTitle', e.target.value)}
                    placeholder="Enter position title"
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="jobLevel">Job Level *</Label>
                  <Select value={newUser.jobLevel} onValueChange={(value) => handleInputChange('jobLevel', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select job level" />
                    </SelectTrigger>
                    <SelectContent>
                      {jobLevels.map((level) => (
                        <SelectItem key={level.name} value={level.name}>
                          {level.name} {level.description && `- ${level.description}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="isLeader">Leadership</Label>
                  <Select 
                    value={newUser.isLeader ? 'true' : 'false'} 
                    onValueChange={(value) => {
                      const isLeader = value === 'true'
                      setNewUser({ 
                        ...newUser, 
                        isLeader,
                        role: isLeader ? UserRole.LEADER : UserRole.MEMBER 
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Member</SelectItem>
                      <SelectItem value="true">Leader</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="role">Role</Label>
                <Select value={newUser.role} onValueChange={(value) => setNewUser({ ...newUser, role: value as UserRole })}>
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
                <Label htmlFor="hierarchy">Hierarchy Level</Label>
                <Select value={newUser.hierarchyLevel} onValueChange={(value) => setNewUser({ ...newUser, hierarchyLevel: value as HierarchyLevel })}>
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
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateUser}>Create User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as UserRole | 'all')}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Filter by role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
            <SelectItem value={UserRole.LEADER}>Leader</SelectItem>
            <SelectItem value={UserRole.MEMBER}>Member</SelectItem>
          </SelectContent>
        </Select>
        <Select value={hierarchyFilter} onValueChange={(value) => setHierarchyFilter(value as HierarchyLevel | 'all')}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Filter by level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value={HierarchyLevel.RF1}>RF1</SelectItem>
            <SelectItem value={HierarchyLevel.RF2}>RF2</SelectItem>
            <SelectItem value={HierarchyLevel.RF3}>RF3</SelectItem>
            <SelectItem value={HierarchyLevel.OF1}>OF1</SelectItem>
            <SelectItem value={HierarchyLevel.OF2}>OF2</SelectItem>
            <SelectItem value={HierarchyLevel.M1}>M1</SelectItem>
            <SelectItem value={HierarchyLevel.M2}>M2</SelectItem>
          </SelectContent>
        </Select>

        {/* View Toggle */}
        <div className="flex items-center border border-slate-200 rounded-lg p-1">
          <Button
            variant={viewMode === 'column' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('column')}
            className={`px-3 ${viewMode === 'column' ? 'bg-blue-600 hover:bg-blue-700' : 'hover:bg-slate-100'}`}
          >
            <LayoutList className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className={`px-3 ${viewMode === 'grid' ? 'bg-blue-600 hover:bg-blue-700' : 'hover:bg-slate-100'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Users List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'grid gap-4'}>
          {users.map((user) => (
            <Card key={user.id} className={`bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow ${viewMode === 'grid' ? 'p-4' : 'p-6'}`}>
              {viewMode === 'grid' ? (
                // Grid View - Compact vertical card
                <div className="flex flex-col h-full">
                  {/* Clickable info area */}
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => openUserTasksModal(user)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <Avatar className="h-14 w-14 rounded-lg ring-2 ring-slate-200">
                        <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 font-semibold text-lg">
                          {user.name ? user.name.split(' ').map(n => n[0]).join('') : <User className="w-6 h-6" />}
                        </AvatarFallback>
                      </Avatar>
                      <Badge variant={user.isActive ? "default" : "secondary"} className="rounded-md px-2 py-0.5 text-xs font-medium">
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>

                    <div>
                      <h3 className="font-semibold text-slate-900 truncate">{user.name}</h3>
                      <div className="flex items-center space-x-1 text-xs font-medium text-slate-500 mt-1">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{user.email}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        <Badge className={`${getRoleColor(user.role)} rounded-md px-2 py-0.5 text-xs font-medium`}>
                          <Shield className="w-3 h-3 mr-1" />
                          {user.role}
                        </Badge>
                        {user.hierarchyLevel ? (
                          <Badge className={`${getHierarchyColor(user.hierarchyLevel)} rounded-md px-2 py-0.5 text-xs font-medium`}>
                            {user.hierarchyLevel}
                          </Badge>
                        ) : user.role === UserRole.ADMIN ? (
                          <Badge className="bg-purple-50 text-purple-700 border border-purple-200 rounded-md px-2 py-0.5 text-xs font-medium">
                            System
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100 text-center text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">{user._count.assignedTasks}</div>
                        <div className="text-slate-500">Tasks</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{user.teamMembers.length}</div>
                        <div className="text-slate-500">Teams</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                        <div className="text-slate-500">Joined</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex space-x-2 mt-3 pt-3 border-t border-slate-100">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditingUser(user)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-amber-600 hover:text-amber-700"
                      onClick={() => setResetPasswordUser(user)}
                      title="Reset Password (set directly)"
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-sky-600 hover:text-sky-700"
                      title="Send password reset link (user picks their own)"
                      onClick={() => handleSendResetLink(user)}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-indigo-600 hover:text-indigo-700"
                      title="Impersonate user (view system as them)"
                      onClick={async () => {
                        if (!confirm(`Sign in as ${user.name}? Session is limited to 30 minutes and is fully audit-logged.`)) return
                        const res = await fetch(`/api/admin/impersonate/${user.id}`, { method: 'POST' })
                        if (res.ok) {
                          const data = await res.json()
                          window.location.href = data.redirectTo ?? '/user/dashboard'
                        } else {
                          const err = await res.json().catch(() => ({}))
                          alert(err.error ?? 'Failed to impersonate')
                        }
                      }}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Deactivate User</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to deactivate {user.name}? This will prevent them from accessing the system.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteUser(user.id)}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            Deactivate
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ) : (
                // Column View - Horizontal card (original layout)
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center space-x-4 flex-1 cursor-pointer"
                    onClick={() => openUserTasksModal(user)}
                  >
                    <Avatar className="h-12 w-12 rounded-lg ring-2 ring-slate-200">
                      <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 font-semibold">
                        {user.name ? user.name.split(' ').map(n => n[0]).join('') : <User className="w-6 h-6" />}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold text-slate-900">{user.name}</h3>
                      <div className="flex items-center space-x-2 text-sm font-medium text-slate-600">
                        <Mail className="w-4 h-4" />
                        <span>{user.email}</span>
                      </div>
                      <div className="flex items-center space-x-2 mt-1">
                        <Badge className={`${getRoleColor(user.role)} rounded-md px-2.5 py-0.5 text-xs font-medium`}>
                          <Shield className="w-3 h-3 mr-1" />
                          {user.role}
                        </Badge>
                        {user.hierarchyLevel ? (
                          <Badge className={`${getHierarchyColor(user.hierarchyLevel)} rounded-md px-2.5 py-0.5 text-xs font-medium`}>
                            {user.hierarchyLevel}
                          </Badge>
                        ) : user.role === UserRole.ADMIN ? (
                          <Badge className="bg-purple-50 text-purple-700 border border-purple-200 rounded-md px-2.5 py-0.5 text-xs font-medium">
                            System Access
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-md px-2.5 py-0.5 text-xs font-medium border-slate-200">
                            No Hierarchy
                          </Badge>
                        )}
                        <Badge variant={user.isActive ? "default" : "secondary"} className="rounded-md px-2.5 py-0.5 text-xs font-medium">
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 text-sm text-gray-600">
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{user._count.assignedTasks}</div>
                      <div>Assigned Tasks</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{user.teamMembers.length}</div>
                      <div>Teams</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </div>
                      <div>Joined</div>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingUser(user)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-amber-600 hover:text-amber-700"
                        onClick={() => setResetPasswordUser(user)}
                        title="Reset Password (set directly)"
                      >
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-sky-600 hover:text-sky-700"
                        title="Send password reset link (user picks their own)"
                        onClick={() => handleSendResetLink(user)}
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-indigo-600 hover:text-indigo-700"
                        title="Impersonate user (view system as them)"
                        onClick={async () => {
                          if (!confirm(`Sign in as ${user.name}? Session is limited to 30 minutes and is fully audit-logged.`)) return
                          const res = await fetch(`/api/admin/impersonate/${user.id}`, { method: 'POST' })
                          if (res.ok) {
                            const data = await res.json()
                            window.location.href = data.redirectTo ?? '/user/dashboard'
                          } else {
                            const err = await res.json().catch(() => ({}))
                            alert(err.error ?? 'Failed to impersonate')
                          }
                        }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to deactivate {user.name}? This will prevent them from accessing the system.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteUser(user.id)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Deactivate
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
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

      {/* User Tasks Modal */}
      <Dialog
        open={!!selectedUserForTasks}
        onOpenChange={(open) => { if (!open) { setSelectedUserForTasks(null); setUserTasks([]) } }}
      >
        <DialogContent padded={false} className="max-w-2xl max-h-[85vh] flex flex-col gap-0">
          {/* Header */}
          <div className="px-6 pr-14 pt-6 pb-4 border-b">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 rounded-xl ring-2 ring-slate-200">
                <AvatarFallback className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 font-bold text-lg">
                  {selectedUserForTasks?.name?.split(' ').map(n => n[0]).join('') ?? <User className="w-5 h-5" />}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-semibold text-slate-900 truncate">
                  {selectedUserForTasks?.name}
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500 truncate">
                  {selectedUserForTasks?.email} · {userTasks.length} task{userTasks.length !== 1 ? 's' : ''} total
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

      {/* Edit User Dialog */}
      {editingUser && (
        <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User: {editingUser.name}</DialogTitle>
              <DialogDescription>
                Update user information, role, and hierarchy level.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Full Name</Label>
                <Input
                  id="edit-name"
                  defaultValue={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-role">Role</Label>
                <Select
                  value={editingUser.role}
                  onValueChange={(value) => setEditingUser({ ...editingUser, role: value as UserRole })}
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
                  value={editingUser.hierarchyLevel || HierarchyLevel.RF1}
                  onValueChange={(value) => setEditingUser({ ...editingUser, hierarchyLevel: value as HierarchyLevel })}
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
              <Button variant="outline" onClick={() => setEditingUser(null)}>
                Cancel
              </Button>
              <Button onClick={() => handleUpdateUser(editingUser.id, {
                name: editingUser.name,
                role: editingUser.role,
                hierarchyLevel: editingUser.hierarchyLevel || undefined,
                isActive: editingUser.isActive
              })}>
                Update User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Reset Password Confirmation Dialog */}
      <AlertDialog open={!!resetPasswordUser} onOpenChange={(open) => { if (!open) setResetPasswordUser(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Password</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset the password for <span className="font-semibold text-slate-900">{resetPasswordUser?.name}</span>? A new random password will be generated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingPassword}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetPassword}
              className="bg-amber-600 hover:bg-amber-700"
              disabled={resettingPassword}
            >
              {resettingPassword ? 'Resetting...' : 'Reset Password'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password Result Dialog */}
      <Dialog open={showPasswordResult} onOpenChange={setShowPasswordResult}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Reset Successful</DialogTitle>
            <DialogDescription>
              The new password has been set. Please copy it now — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-sm text-slate-500">New Password</Label>
            <div className="flex items-center space-x-2 mt-1">
              <code className="flex-1 bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 text-sm font-mono select-all">
                {generatedPassword}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyPassword}
                className="shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowPasswordResult(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUserActionsDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        onCompleted={fetchUsers}
      />

      <Dialog open={!!resetLinkInfo} onOpenChange={open => { if (!open) setResetLinkInfo(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password reset link</DialogTitle>
            <DialogDescription>
              {resetLinkInfo
                ? <>Copy this one-time link and send it to <strong>{resetLinkInfo.email}</strong>. It expires {new Date(resetLinkInfo.expiresAt).toLocaleString()}.</>
                : null}
            </DialogDescription>
          </DialogHeader>
          {resetLinkInfo && (
            <div className="py-4">
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 text-xs font-mono break-all select-all">
                  {resetLinkInfo.url}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(resetLinkInfo.url)
                      setResetLinkCopied(true)
                      setTimeout(() => setResetLinkCopied(false), 2000)
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {resetLinkCopied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                The link will not be shown again. If lost, generate a new one.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResetLinkInfo(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}