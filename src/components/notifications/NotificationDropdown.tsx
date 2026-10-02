'use client'

import { useState } from 'react'
import { Bell, Check, CheckCheck, Clock, ExternalLink } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useNotifications } from '@/hooks/useNotifications'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

interface NotificationDropdownProps {
  isCollapsed?: boolean
}

export function NotificationDropdown({ isCollapsed = false }: NotificationDropdownProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const { notifications, unreadCount, loading, markOneAsRead, markAllAsRead } = useNotifications()
  const [isOpen, setIsOpen] = useState(false)

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open && unreadCount > 0) {
      markAllAsRead()
    }
  }

  const getNotificationHref = (notification: any) => {
    if (notification.entityType === 'team_invitation') return '/user/teams'
    if (notification.entityType === 'team' && notification.entityId) return `/user/teams/${notification.entityId}`
    if (notification.entityType !== 'task' || !notification.entityId) return null
    return `/user/tasks?taskId=${notification.entityId}`
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'TASK_ASSIGNED':
        return <div className="w-2 h-2 rounded-full bg-blue-500" />
      case 'TASK_UPDATED':
        return <div className="w-2 h-2 rounded-full bg-yellow-500" />
      case 'TASK_COMPLETED':
        return <div className="w-2 h-2 rounded-full bg-green-500" />
      case 'COMMENT_ADDED':
        return <div className="w-2 h-2 rounded-full bg-purple-500" />
      case 'MENTION':
        return <div className="w-2 h-2 rounded-full bg-pink-500" />
      case 'DEADLINE_REMINDER':
        return <div className="w-2 h-2 rounded-full bg-red-500" />
      default:
        return <div className="w-2 h-2 rounded-full bg-gray-500" />
    }
  }

  const handleNotificationClick = (notification: any) => {
    if (!notification.isRead) {
      markOneAsRead(notification.id)
    }
    setIsOpen(false)
    const href = getNotificationHref(notification)
    if (href) {
      router.push(href)
    }
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'relative hover:bg-accent hover:text-accent-foreground transition-colors',
            isCollapsed ? 'w-8 h-8 p-0 justify-center' : 'w-full justify-start px-3 py-2.5'
          )}
        >
          <Bell className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && <span className="ml-3 truncate">Notifications</span>}
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className={cn(
                'h-5 min-w-5 flex items-center justify-center text-xs font-semibold',
                isCollapsed
                  ? 'absolute -top-1 -right-1 px-1'
                  : 'ml-auto px-1.5'
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={isCollapsed ? 'right' : 'top'}
        className="w-80"
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault()
                markAllAsRead()
              }}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {loading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center">
            <Bell className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No notifications yet</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={cn(
                  'flex flex-col items-start p-3 cursor-pointer focus:bg-accent',
                  !notification.isRead && 'bg-blue-50/50 dark:bg-blue-950/20'
                )}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start gap-3 w-full">
                  <div className="mt-1.5">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm leading-tight',
                      !notification.isRead && 'font-medium'
                    )}>
                      {notification.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {notification.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </span>
                      {!notification.isRead && (
                        <Badge variant="secondary" className="h-4 text-[10px] px-1">
                          New
                        </Badge>
                      )}
                    </div>
                  </div>
                  {notification.entityId && (
                    <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </ScrollArea>
        )}

        <DropdownMenuSeparator />
        <button
          onClick={() => router.push('/user/notifications')}
          className="w-full text-center text-xs font-semibold text-blue-600 hover:text-blue-700 py-2 border-t"
        >
          View all notifications
        </button>

      </DropdownMenuContent>
    </DropdownMenu>
  )
}
