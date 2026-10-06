import { describe, it, expect, afterEach } from 'vitest'
import { appUrl, appLink } from './app-url'

describe('appUrl', () => {
  afterEach(() => { delete process.env.APP_URL })
  it('defaults to the public domain, not NEXTAUTH_URL', () => {
    delete process.env.APP_URL
    process.env.NEXTAUTH_URL = 'http://10.100.100.86:3000'
    expect(appUrl()).toBe('https://tms.hotelsogo.com')
    expect(appLink('/user/teams')).toBe('https://tms.hotelsogo.com/user/teams')
  })
  it('honours APP_URL and drops a trailing slash', () => {
    process.env.APP_URL = 'https://example.test/'
    expect(appLink('user/x')).toBe('https://example.test/user/x')
  })
})
