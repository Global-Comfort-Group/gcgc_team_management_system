import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

vi.mock('@/lib/oss', () => ({
  uploadToOSS: vi.fn(async () => ({ url: 'https://signed.example/x', objectKey: 'x' })),
  deleteFromOSS: vi.fn(async () => {}),
  getSignedUrl: vi.fn(() => 'https://signed.example/x'),
}))

import {
  isSafeKey, keyFromLink, isFileLink, linkFor, localPath, safeExtension,
  saveFile, deleteFile, storageBackend, openStoredFile, FILES_ROUTE,
} from './storage'
import { uploadToOSS, deleteFromOSS } from '@/lib/oss'

describe('keys', () => {
  it('accepts the shapes the upload routes produce', () => {
    expect(isSafeKey('tasks/cmabc123/1700000000001-Site_Plan_-_Rev_2.pdf')).toBe(true)
    expect(isSafeKey('comments/ctask1/1700000000002-cuser1.png')).toBe(true)
    expect(isSafeKey('profiles/cuser1-1700000000003.jpg')).toBe(true)
    expect(isSafeKey('procurement/ctask1/1-cuser1-PO.xlsx')).toBe(true)
  })
  it('refuses anything that could leave the storage folder or need encoding', () => {
    for (const k of ['../etc/passwd', 'tasks/../../x', '/abs/path', 'tasks//x', 'a b.pdf', 'tasks/./x', 'x?y', '']) {
      expect(isSafeKey(k)).toBe(false)
    }
  })
  it('reduces extensions to letters and digits', () => {
    expect(safeExtension('photo.JPG')).toBe('jpg')
    expect(safeExtension('x.p n"g')).toBe('png')
    expect(safeExtension('noext')).toBe('noext')
    expect(safeExtension('trailing.')).toBe('bin')
  })
})

describe('links', () => {
  const key = 'tasks/cmabc123/1700000000004-report.pdf'
  it('makes and reads the permanent form', () => {
    expect(linkFor(key)).toBe(FILES_ROUTE + key)
    expect(keyFromLink(linkFor(key))).toBe(key)
    expect(keyFromLink(`https://tms.example.com${linkFor(key)}`)).toBe(key)
  })
  it('reads legacy signed OSS URLs', () => {
    const legacy = `https://bucket-x.oss-ap-southeast-6.aliyuncs.com/${key}?OSSAccessKeyId=AK&Expires=1&Signature=s%3D`
    expect(keyFromLink(legacy)).toBe(key)
  })
  it('ignores everything else', () => {
    expect(keyFromLink(null)).toBeNull()
    expect(keyFromLink('https://lh3.googleusercontent.com/a/photo')).toBeNull()
    expect(keyFromLink('/uploads/profiles/x.jpg')).toBeNull()
    expect(keyFromLink('/api/files/../secret')).toBeNull()
    expect(keyFromLink('https://evil.example/x/api/files/tasks/a/b.pdf')).toBeNull()
  })
  it('validates what the API accepts as a stored link', () => {
    expect(isFileLink(linkFor(key))).toBe(true)
    expect(isFileLink('https://bucket.oss-ap-southeast-6.aliyuncs.com/x.pdf?Signature=1')).toBe(true)
    expect(isFileLink('/api/files/../x')).toBe(false)
    expect(isFileLink('javascript:alert(1)')).toBe(false)
    expect(isFileLink('/somewhere/else')).toBe(false)
  })
})

describe('local storage', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'tms-storage-'))
    process.env.STORAGE_DIR = dir
    delete process.env.STORAGE_BACKEND
    vi.clearAllMocks()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.STORAGE_DIR
    delete process.env.STORAGE_BACKEND
  })

  it('defaults to local', () => {
    expect(storageBackend()).toBe('local')
  })
  it('rejects an unknown backend instead of guessing', () => {
    process.env.STORAGE_BACKEND = 's3'
    expect(() => storageBackend()).toThrow()
  })
  it('keeps paths inside the storage folder', () => {
    expect(localPath('tasks/u/1-a.pdf')).toBe(path.join(dir, 'tasks', 'u', '1-a.pdf'))
    expect(() => localPath('../x')).toThrow()
  })
  it('saves under the key, leaves no temporary file, returns the permanent link', async () => {
    const r = await saveFile('comments/t1/1-u1-note.txt', Buffer.from('hello'), 'text/plain')
    expect(r).toEqual({ url: '/api/files/comments/t1/1-u1-note.txt', objectKey: 'comments/t1/1-u1-note.txt' })
    expect(readFileSync(path.join(dir, 'comments', 't1', '1-u1-note.txt'), 'utf8')).toBe('hello')
    expect(readdirSync(path.join(dir, 'comments', 't1'))).toEqual(['1-u1-note.txt'])
    expect(uploadToOSS).not.toHaveBeenCalled()
  })
  it('refuses to save an unsafe key', async () => {
    await expect(saveFile('../x', Buffer.from('x'), 'text/plain')).rejects.toThrow()
  })
  it('deletes the local copy, never the bucket copy, and ignores missing files', async () => {
    await saveFile('tasks/u/1-a.pdf', Buffer.from('x'), 'application/pdf')
    await deleteFile('tasks/u/1-a.pdf')
    expect(existsSync(path.join(dir, 'tasks', 'u', '1-a.pdf'))).toBe(false)
    await expect(deleteFile('tasks/u/never-existed.pdf')).resolves.toBeUndefined()
    expect(deleteFromOSS).not.toHaveBeenCalled()
  })
  it('never throws from deleteFile, even with a bad backend setting', async () => {
    process.env.STORAGE_BACKEND = 'nonsense'
    await expect(deleteFile('tasks/u/1-a.pdf')).resolves.toBeUndefined()
  })
  it('opens a stored file from disk, and returns null for one that exists nowhere', async () => {
    await saveFile('tasks/u/1-a.txt', Buffer.from('abc'), 'text/plain')
    const f = await openStoredFile('tasks/u/1-a.txt')
    expect(f?.size).toBe(3)
    expect(Buffer.from(await new Response(f!.body).arrayBuffer()).toString()).toBe('abc')
    expect(await openStoredFile('tasks/u/missing.txt')).toBeNull()   // no OSS settings in tests
    expect(await openStoredFile('../x')).toBeNull()
  })
  it('writes to OSS when told to, and still returns the permanent link', async () => {
    process.env.STORAGE_BACKEND = 'oss'
    const r = await saveFile('tasks/u/1-a.pdf', Buffer.from('x'), 'application/pdf')
    expect(uploadToOSS).toHaveBeenCalledWith(expect.any(Buffer), 'tasks/u/1-a.pdf', 'application/pdf')
    expect(r.url).toBe('/api/files/tasks/u/1-a.pdf')
  })
})
