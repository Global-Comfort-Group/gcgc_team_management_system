import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderNotificationEmail } from './email'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send } })) }))

describe('renderNotificationEmail', () => {
  it('puts the title in the subject and title+message in the html', () => {
    const { subject, html } = renderNotificationEmail({ title: 'Task assigned', message: 'You were assigned "Try"', url: 'https://x/y' })
    expect(subject).toContain('Task assigned')
    expect(html).toContain('Task assigned')
    expect(html).toContain('You were assigned')
    expect(html).toContain('https://x/y')
  })

  it('HTML-escapes user content to prevent injection in the email body', () => {
    const { html } = renderNotificationEmail({ title: '<img src=x onerror=alert(1)>', message: '</p><a href="evil">x</a>' })
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<a href="evil">')
  })
})

describe('sendNotificationEmail', () => {

  beforeEach(() => { send.mockReset(); process.env.RESEND_API_KEY = 'k' })
  afterEach(() => { delete process.env.RESEND_API_KEY })

  it('throws EmailNotConfiguredError when the API key is missing', async () => {
    delete process.env.RESEND_API_KEY
    const { sendNotificationEmail, EmailNotConfiguredError } = await import('./email')
    await expect(sendNotificationEmail('a@b.c', { title: 't', message: 'm' })).rejects.toBeInstanceOf(EmailNotConfiguredError)
    expect(send).not.toHaveBeenCalled()
  })

  it('throws when Resend reports an error in its result (it does not throw itself)', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'domain is not verified' } })
    const { sendNotificationEmail } = await import('./email')
    await expect(sendNotificationEmail('a@b.c', { title: 't', message: 'm' })).rejects.toThrow(/domain is not verified/)
  })

  it('resolves on a successful send', async () => {
    send.mockResolvedValue({ data: { id: '1' }, error: null })
    const { sendNotificationEmail } = await import('./email')
    await expect(sendNotificationEmail('a@b.c', { title: 't', message: 'm' })).resolves.toBeUndefined()
  })
})
