'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import {
  User, Mail, Phone, Building2, Briefcase, Calendar, Shield,
  Edit2, Save, X, CheckCircle, AlertCircle, Camera, MapPin,
  Clock, Award, TrendingUp, Activity, Settings, Eye, EyeOff, Lock
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { avatarEvents } from '@/lib/avatar-events'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { ApiTokensCard } from '@/components/settings/ApiTokensCard'

interface UserProfile {
  id: string
  email: string
  username?: string
  firstName?: string
  lastName?: string
  middleName?: string
  name?: string
  contactNumber?: string
  image?: string
  role: string
  hierarchyLevel?: string
  division?: string
  department?: string
  section?: string
  team?: string
  positionTitle?: string
  jobLevel?: string
  organizationalPath?: string
  isLeader: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function UserProfilePage() {
  const { data: session, update: updateSession } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({})
  const [error, setError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Change password state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [changingPassword, setChangingPassword] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  useEffect(() => {
    if (!session?.user) return

    const fetchProfile = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/users/${session.user.id}`)
        if (!response.ok) {
          throw new Error('Failed to fetch profile data')
        }
        const data = await response.json()
        setProfile(data)
        setEditedProfile(data)
      } catch (err) {
        console.error('Error fetching profile:', err)
        setError('Failed to load profile data')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [session])

  const handleFieldEdit = (field: string) => {
    setEditingField(field)
  }

  const handleFieldSave = async (field: string) => {
    if (!profile) return

    try {
      setSaving(true)
      const response = await fetch(`/api/users/${profile.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [field]: editedProfile[field as keyof UserProfile],
        }),
      })

      if (!response.ok) {
        const e = await response.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to update profile')
      }

      const updatedData = await response.json()
      setProfile(updatedData.user)
      setEditedProfile(updatedData.user)
      setEditingField(null)

      // Update session if name changed
      if (field === 'firstName' || field === 'lastName') {
        await updateSession({
          ...session,
          user: {
            ...session?.user,
            name: `${updatedData.user.firstName || ''} ${updatedData.user.lastName || ''}`.trim()
          }
        })
      }

      toast({
        title: 'Success',
        description: field === 'email'
          ? 'Email updated. You may need to sign in again with your new email.'
          : 'Profile updated successfully',
      })
    } catch (err: any) {
      console.error('Error updating profile:', err)
      toast({
        title: 'Error',
        description: err?.message || 'Failed to update profile',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleFieldCancel = (field: string) => {
    setEditedProfile(prev => ({
      ...prev,
      [field]: profile?.[field as keyof UserProfile]
    }))
    setEditingField(null)
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profile) return

    try {
      setUploadingImage(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('userId', profile.id)

      const response = await fetch('/api/upload/profile-image', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Failed to upload image')
      }

      const data = await response.json()

      setProfile(prev => prev ? { ...prev, image: data.imageUrl } : null)

      // Update the session with new image - this will trigger JWT callback with trigger='update'
      await updateSession({
        user: {
          image: data.imageUrl
        }
      })

      // Emit event to sync avatar across all components (sidebar, etc.)
      avatarEvents.emit(data.imageUrl)

      toast({
        title: 'Success',
        description: 'Profile picture updated successfully',
      })
    } catch (err) {
      console.error('Error uploading image:', err)
      toast({
        title: 'Error',
        description: 'Failed to upload profile picture',
        variant: 'destructive',
      })
    } finally {
      setUploadingImage(false)
      // Reset file input so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleChangePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast({
        title: 'Error',
        description: 'Please fill in all password fields',
        variant: 'destructive',
      })
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({
        title: 'Error',
        description: 'New passwords do not match',
        variant: 'destructive',
      })
      return
    }

    if (passwordForm.newPassword.length < 8) {
      toast({
        title: 'Error',
        description: 'New password must be at least 8 characters',
        variant: 'destructive',
      })
      return
    }

    try {
      setChangingPassword(true)
      const response = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to change password')
      }

      toast({
        title: 'Success',
        description: 'Your password has been changed successfully',
      })

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setShowCurrentPassword(false)
      setShowNewPassword(false)
      setShowConfirmPassword(false)
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to change password',
        variant: 'destructive',
      })
    } finally {
      setChangingPassword(false)
    }
  }

  const getInitials = (name?: string) => {
    if (!name) return 'U'
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    }
    return name[0].toUpperCase()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton Loader - Flat Design */}
        <div className="h-48 bg-gray-300 rounded-none animate-pulse border-0" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse border-0 rounded-none">
              <CardContent className="p-6">
                <div className="h-3 bg-gray-300 rounded-none w-3/4 mb-3" />
                <div className="h-7 bg-gray-300 rounded-none w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Error Loading Profile</h3>
            <p className="text-muted-foreground">{error || 'Failed to load profile data'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const InlineEditField = ({
    field,
    label,
    icon: Icon,
    type = 'text',
    editable = true
  }: {
    field: keyof UserProfile
    label: string
    icon: any
    type?: string
    editable?: boolean
  }) => {
    const isEditing = editingField === field
    const value = editedProfile[field] as string || ''

    return (
      <div
        onClick={() => { if (editable && !isEditing) handleFieldEdit(field) }}
        className={cn(
          'group rounded-lg border p-3 transition-all',
          isEditing
            ? 'border-blue-300 bg-blue-50/30 ring-1 ring-blue-200'
            : editable
              ? 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm cursor-pointer'
              : 'border-slate-100 bg-slate-50/60'
        )}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <div className={cn('grid place-items-center h-6 w-6 rounded-md shrink-0', editable ? 'bg-blue-50' : 'bg-slate-100')}>
            <Icon className={cn('h-3.5 w-3.5', editable ? 'text-blue-500' : 'text-slate-400')} />
          </div>
          <Label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold flex-1">{label}</Label>
          {!editable ? (
            <Lock className="h-3 w-3 text-slate-300 shrink-0" />
          ) : !isEditing ? (
            <Edit2 className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
          ) : null}
        </div>
        {isEditing ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Input
              type={type}
              value={value}
              onChange={(e) => setEditedProfile(prev => ({ ...prev, [field]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleFieldSave(field); if (e.key === 'Escape') handleFieldCancel(field) }}
              className="h-8 text-sm rounded-md"
              autoFocus
            />
            <Button size="sm" variant="ghost" onClick={() => handleFieldSave(field)} disabled={saving} className="h-8 w-8 p-0 shrink-0">
              <CheckCircle className="h-4 w-4 text-green-600" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleFieldCancel(field)} className="h-8 w-8 p-0 shrink-0">
              <X className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ) : (
          <p className={cn('text-sm', value ? 'font-semibold text-slate-900' : 'text-slate-400 italic')}>{value || 'Not set'}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Hero Header with Cover - Professional */}
      <Card className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
        <div className="h-20 sm:h-28 bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 relative overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="absolute -bottom-6 -right-6 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -top-4 -left-4 h-24 w-24 rounded-full bg-white/10" />
        </div>
        <CardContent className="relative pb-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 -mt-12 sm:-mt-14">
            <div className="relative group">
              <Avatar
                key={profile.image || 'no-image'}
                className="h-24 w-24 border-4 border-white ring-2 ring-slate-200 rounded-xl shadow-lg"
              >
                {/* Force browser to reload image by using unique key on AvatarImage */}
                <AvatarImage
                  key={profile.image || 'no-image-src'}
                  src={profile.image || undefined}
                  alt={profile.name}
                />
                <AvatarFallback className="text-2xl bg-blue-100 text-blue-700 font-bold rounded-xl">
                  {getInitials(profile.name)}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {uploadingImage ? (
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                ) : (
                  <Camera className="h-8 w-8 text-white" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>

            <div className="flex-1 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{profile.name}</h1>
                <div className="flex items-center gap-2 justify-center sm:justify-start">
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 font-medium rounded-md">
                    <Shield className="h-3 w-3 mr-1" />
                    {profile.role}
                  </Badge>
                  {profile.isLeader && (
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 font-medium rounded-md">
                      <Award className="h-3 w-3 mr-1" />
                      Team Leader
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-slate-600 flex items-center justify-center sm:justify-start gap-2 font-medium mt-1">
                <Briefcase className="h-4 w-4 text-slate-400" />
                {profile.positionTitle || 'No position title'}
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-sm text-slate-600 font-medium">
                <div className="flex items-center gap-1">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {profile.email}
                </div>
                {profile.contactNumber && (
                  <div className="flex items-center gap-1">
                    <Phone className="h-4 w-4 text-slate-400" />
                    {profile.contactNumber}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  Joined {format(new Date(profile.createdAt), 'MMM yyyy')}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Badge
                variant="secondary"
                className={profile.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200 font-medium rounded-md' : 'bg-slate-100 text-slate-600 border-slate-200 font-medium rounded-md'}
              >
                <div className={`h-1.5 w-1.5 rounded-full mr-1.5 ${profile.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {profile.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key facts — one cohesive, on-theme band (no rainbow cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl border border-slate-200 bg-slate-200/70 overflow-hidden shadow-sm">
        {[
          { label: 'Department', value: profile.department, icon: Building2 },
          { label: 'Team', value: profile.team, icon: User },
          { label: 'Hierarchy Level', value: profile.hierarchyLevel, icon: TrendingUp },
          { label: 'Job Level', value: profile.jobLevel, icon: Award },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="group flex items-center gap-3 bg-white p-3.5 transition-colors hover:bg-blue-50/40">
            <div className="grid place-items-center h-9 w-9 rounded-lg bg-blue-50 text-blue-600 shrink-0 group-hover:bg-blue-100 transition-colors">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
              <p className="text-base font-bold text-slate-900 truncate">{value || 'N/A'}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabbed Content - Professional */}
      <Tabs defaultValue="personal" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1 border border-slate-200 rounded-lg">
          <TabsTrigger
            value="personal"
            className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm font-medium rounded-md"
          >
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Personal Info</span>
            <span className="sm:hidden">Personal</span>
          </TabsTrigger>
          <TabsTrigger
            value="organization"
            className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm font-medium rounded-md"
          >
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Organization</span>
            <span className="sm:hidden">Org</span>
          </TabsTrigger>
          <TabsTrigger
            value="account"
            className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm font-medium rounded-md"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Account</span>
            <span className="sm:hidden">Account</span>
          </TabsTrigger>
        </TabsList>

        {/* Personal Information Tab */}
        <TabsContent value="personal" className="space-y-4">
          <Card className="border border-slate-200 rounded-xl shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
                Personal Information
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 font-medium mt-1">
                Update your personal details. Position title and organizational placement are managed by an administrator.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <InlineEditField field="firstName" label="First Name" icon={User} />
              <InlineEditField field="lastName" label="Last Name" icon={User} />
              <InlineEditField field="middleName" label="Middle Name" icon={User} />
              <InlineEditField field="contactNumber" label="Contact Number" icon={Phone} type="tel" />
              <InlineEditField field="positionTitle" label="Position Title" icon={Briefcase} editable={false} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Organization Tab */}
        <TabsContent value="organization" className="space-y-4">
          <Card className="border border-slate-200 rounded-xl shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Building2 className="h-4 w-4 text-blue-600" />
                </div>
                Organizational Structure
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 font-medium mt-1">
                Your position within the organizational hierarchy. Contact an administrator to request changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <InlineEditField field="division" label="Division" icon={Building2} editable={false} />
              <InlineEditField field="department" label="Department" icon={Building2} editable={false} />
              <InlineEditField field="section" label="Section" icon={Building2} editable={false} />
              <InlineEditField field="team" label="Team" icon={User} editable={false} />
              <Separator className="my-4" />
              <InlineEditField field="jobLevel" label="Job Level" icon={Award} editable={false} />
              <InlineEditField field="hierarchyLevel" label="Hierarchy Level" icon={TrendingUp} editable={false} />

              {profile.organizationalPath && (
                <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <Label className="text-xs text-slate-700 font-semibold mb-2 block">Full Organizational Path</Label>
                  <p className="text-sm font-mono text-slate-900 font-medium">{profile.organizationalPath}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-4">
          <Card className="border border-slate-200 rounded-xl shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Settings className="h-4 w-4 text-blue-600" />
                </div>
                Account Settings
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 font-medium mt-1">
                Account credentials and security information. Changing your email may require signing in again.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <InlineEditField field="email" label="Email Address" icon={Mail} type="email" />
              <InlineEditField field="username" label="Username" icon={User} />

              <Separator className="my-4" />

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-200">
                      <Calendar className="h-4 w-4 text-slate-600" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500 font-semibold">Account Created</Label>
                      <p className="font-semibold text-sm mt-0.5 text-slate-900">{format(new Date(profile.createdAt), 'PPP')}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-200">
                      <Clock className="h-4 w-4 text-slate-600" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500 font-semibold">Last Updated</Label>
                      <p className="font-semibold text-sm mt-0.5 text-slate-900">{format(new Date(profile.updatedAt), 'PPP')}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${profile.isActive ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                      <Activity className={`h-4 w-4 ${profile.isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500 font-semibold">Account Status</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <div className={`h-1.5 w-1.5 rounded-full ${profile.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                        <p className="font-semibold text-sm text-slate-900">{profile.isActive ? 'Active' : 'Inactive'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <NotificationSettings />

          {/* API Tokens */}
          <ApiTokensCard />

          {/* Change Password Card */}
          <Card className="border border-slate-200 rounded-xl shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <Lock className="h-4 w-4 text-slate-600" />
                </div>
                Change Password
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 font-medium mt-1">
                Update your password to keep your account secure
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword" className="text-sm font-semibold text-slate-700">Current Password</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                      placeholder="Enter current password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-sm font-semibold text-slate-700">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                      placeholder="Enter new password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">Must be at least 8 characters with uppercase, lowercase, and a number</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-semibold text-slate-700">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      placeholder="Confirm new password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Passwords do not match
                    </p>
                  )}
                </div>

                <div className="pt-2">
                  <Button
                    onClick={handleChangePassword}
                    disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {changingPassword ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Changing Password...
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4 mr-2" />
                        Change Password
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
