import { describe, it, expect } from 'vitest'
import { plannedDeliveries } from './notification-delivery'

describe('plannedDeliveries', () => {
  it('returns the enabled channels only', () => {
    expect(plannedDeliveries({ emailNotifications: true, pushNotifications: true })).toEqual(['email', 'push'])
    expect(plannedDeliveries({ emailNotifications: true, pushNotifications: false })).toEqual(['email'])
    expect(plannedDeliveries({ emailNotifications: false, pushNotifications: false })).toEqual([])
  })
})

describe('entityUrl', () => {
  it('links tasks with ?taskId= on the public domain', async () => {
    delete process.env.APP_URL // the local .env sets one
    const { entityUrl } = await import('./notification-delivery')
    expect(entityUrl({ entityType: 'task', entityId: 't1' })).toBe('https://tms.hotelsogo.com/user/tasks?taskId=t1')
    expect(entityUrl({ entityType: 'team_invitation', entityId: 'i1' })).toBe('https://tms.hotelsogo.com/user/teams')
    expect(entityUrl({})).toBe('https://tms.hotelsogo.com/user/dashboard')
  })
})
