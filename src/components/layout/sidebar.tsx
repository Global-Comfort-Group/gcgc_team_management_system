'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  Calendar,
  Settings,
  LogOut,
  Menu,
  X,
  User,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  FileText,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  BarChart2,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Star,
} from 'lucide-react'
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { avatarEvents } from '@/lib/avatar-events'

const adminNavItems = [
  {
    title: 'Dashboard',
    href: '/admin/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Teams',
    href: '/admin/teams',
    icon: Users,
  },
  {
    title: 'Members',
    href: '/admin/members',
    icon: User,
  },
  {
    title: 'Tasks',
    href: '/admin/tasks',
    icon: CheckSquare,
  },
  {
    title: 'Calendar',
    href: '/admin/calendar',
    icon: Calendar,
  },
  {
    title: 'TMS Chat',
    href: process.env.NEXT_PUBLIC_TMS_CHAT_URL || 'https://tms-chat-staging.hotelsogo-ai.com',
    icon: MessageSquare,
    external: true,
  },
  {
    title: 'Settings',
    href: '/admin/settings',
    icon: Settings,
  },
]

const userNavItems = [
  {
    title: 'Dashboard',
    href: '/user/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Tasks',
    href: '/user/tasks',
    icon: CheckSquare,
  },
  {
    title: 'Teams',
    href: '/user/teams',
    icon: Users,
  },
  {
    title: 'Calendar',
    href: '/user/calendar',
    icon: Calendar,
  },
  // { title: 'OSSB Requests', href: '/user/ossb', icon: FileText },
  {
    title: 'TMS Chat',
    href: process.env.NEXT_PUBLIC_TMS_CHAT_URL || 'https://tms-chat-staging.hotelsogo-ai.com',
    icon: MessageSquare,
    external: true,
  },
  {
    title: 'Profile',
    href: '/user/profile',
    icon: User,
  },
]

const leaderNavItems = [
  {
    title: 'Dashboard',
    href: '/user/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Tasks',
    href: '/user/tasks',
    icon: CheckSquare,
  },
  {
    title: 'Teams',
    href: '/user/teams',
    icon: Users,
  },
  {
    title: 'Calendar',
    href: '/user/calendar',
    icon: Calendar,
  },
  // { title: 'OSSB Requests', href: '/user/ossb', icon: FileText },
  {
    title: 'Team Overview',
    href: '/user/team-overview',
    icon: Users,
  },
  {
    title: 'Member Management',
    href: '/user/member-management',
    icon: UserCheck,
  },
  // { title: 'Workload', href: '/user/workload', icon: BarChart2 },
  { title: 'Evaluations', href: '/user/evaluations', icon: Star },
  {
    title: 'TMS Chat',
    href: process.env.NEXT_PUBLIC_TMS_CHAT_URL || 'https://tms-chat-staging.hotelsogo-ai.com',
    icon: MessageSquare,
    external: true,
  },
  {
    title: 'Profile',
    href: '/user/profile',
    icon: User,
  },
]

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined)

  // Subscribe to avatar update events from profile page
  useEffect(() => {
    // Initialize with session image
    if (session?.user?.image) {
      setAvatarUrl(session.user.image)
    }

    // Subscribe to avatar updates
    const unsubscribe = avatarEvents.subscribe((newImageUrl) => {
      setAvatarUrl(newImageUrl)
    })

    return () => unsubscribe()
  }, [session?.user?.image])

  // Handle escape key to close mobile sidebar
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileOpen(false)
      }
    }

    if (isMobileOpen) {
      document.addEventListener('keydown', handleEscape)
      // Prevent body scroll when mobile sidebar is open
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isMobileOpen])

  // Remember collapsed state in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved) {
      setIsCollapsed(JSON.parse(saved))
    }
  }, [])

  const toggleCollapsed = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState))
    // Trigger storage event for other components to listen
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'sidebar-collapsed',
      newValue: JSON.stringify(newState),
      oldValue: JSON.stringify(isCollapsed)
    }))
  }

  if (!session?.user) return null


  const isAdmin = session.user.role === 'ADMIN'
  const isLeader = session.user.role === 'LEADER'
  const navItems = isAdmin ? adminNavItems : (isLeader ? leaderNavItems : userNavItems)
  const portalName = isAdmin ? 'Admin Portal' : 'User Portal'

  const handleSignOut = () => {
    signOut({ callbackUrl: '/auth/signin' })
  }

  const sidebarWidth = isCollapsed ? 'w-16' : 'w-64'
  const sidebarTransition = 'transition-all duration-300 ease-in-out'

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile toggle button */}
      <Button
        variant="outline"
        size="sm"
        className="fixed top-4 left-4 z-50 lg:hidden"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        {isMobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-dvh bg-background border-r border-border shadow-lg',
          // Always full width on mobile, respect collapse state only on desktop
          'w-64',
          isCollapsed ? 'lg:w-16' : 'lg:w-64',
          sidebarTransition,
          // Mobile styles
          'lg:translate-x-0',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          className
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <Link
              href={isAdmin ? '/admin/dashboard' : '/user/dashboard'}
              className={cn(
                'flex items-center space-x-3 hover:opacity-80 transition-opacity',
                isCollapsed && 'lg:justify-center lg:space-x-0'
              )}
            >
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/80 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
                <div className="w-4 h-4 bg-white rounded-sm"></div>
              </div>
              <div className={cn('min-w-0', isCollapsed && 'lg:hidden')}>
                <h1 className="text-xl font-bold text-foreground truncate">GCGC</h1>
                <span className="text-xs text-muted-foreground font-medium block truncate">
                  {portalName}
                </span>
              </div>
            </Link>

            {/* Desktop collapse toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCollapsed}
              className="hidden lg:flex h-8 w-8 p-0"
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                const linkProps = item.external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {}

                // Use regular <a> tag for external links to avoid middleware interception
                const LinkComponent = item.external ? 'a' : Link

                return (
                  <LinkComponent
                    key={item.href}
                    href={item.href}
                    {...linkProps}
                    className={cn(
                      'flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-sm group',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      isCollapsed && 'lg:justify-center lg:space-x-0'
                    )}
                    onClick={() => setIsMobileOpen(false)}
                    title={isCollapsed ? item.title : undefined}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className={cn('truncate', isCollapsed && 'lg:hidden')}>
                      {item.title}
                    </span>
                    {isCollapsed && (
                      <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden lg:block">
                        {item.title}
                      </span>
                    )}
                  </LinkComponent>
                )
              })}
            </div>
          </nav>

          {/* User section */}
          <div className="border-t border-border p-4 space-y-4 shrink-0">
            {/* Notifications */}
            <NotificationDropdown isCollapsed={isCollapsed} />

            {/* User info */}
            <Link
              href="/user/profile"
              className={cn(
                'flex items-center space-x-3 p-2 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group',
                isCollapsed && 'lg:justify-center lg:space-x-0 lg:p-1'
              )}
              title={isCollapsed ? `${session.user.name || 'User'} - Go to Profile` : undefined}
              onClick={() => setIsMobileOpen(false)}
            >
              <Avatar
                key={avatarUrl || 'no-image'}
                className="h-8 w-8 flex-shrink-0 ring-2 ring-transparent group-hover:ring-primary/20 transition-all"
              >
                <AvatarImage
                  src={avatarUrl || undefined}
                  alt={session.user.name || 'Profile'}
                  className="object-cover"
                />
                <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-medium text-sm group-hover:from-primary/20 group-hover:to-primary/30 transition-all">
                  {session.user.name
                    ? session.user.name.split(' ').map(n => n[0]).join('')
                    : session.user.email?.[0]?.toUpperCase()
                  }
                </AvatarFallback>
              </Avatar>
              <div className={cn('min-w-0 flex-1', isCollapsed && 'lg:hidden')}>
                <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {session.user.name || 'User'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {session.user.email}
                </p>
              </div>
              {isCollapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden lg:block whitespace-nowrap">
                  {session.user.name || 'User'} - Profile
                </span>
              )}
            </Link>

            {/* Sign out button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className={cn(
                'w-full justify-start hover:bg-destructive hover:text-destructive-foreground transition-colors',
                isCollapsed && 'lg:w-8 lg:h-8 lg:p-0 lg:justify-center'
              )}
              title={isCollapsed ? 'Sign Out' : undefined}
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              <span className={cn('ml-2', isCollapsed && 'lg:hidden')}>Sign Out</span>
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}