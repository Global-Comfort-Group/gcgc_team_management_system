import { mkdir, rename, stat, unlink, writeFile } from 'fs/promises'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import { randomBytes } from 'crypto'
import { uploadToOSS, deleteFromOSS, getSignedUrl } from '@/lib/oss'

/**
 * Where uploaded files live, and the one link format the database stores for them.
 *
 * Every stored link is `/api/files/<key>` - a path on TMS itself, never a cloud URL.
 * That route (src/app/api/files/[...key]/route.ts) checks the session and the
 * user's access to the owning task, then serves the file from local disk, falling
 * back to a fresh signed OSS URL for a file not copied locally yet. So a link
 * never expires, never carries a signature, and does not change when the storage
 * backend does.
 *
 * STORAGE_BACKEND decides only where NEW uploads are written:
 *   local (default)  STORAGE_DIR on this server
 *   oss              the Alibaba bucket in OSS_*
 *
 * Keys keep the shape they always had (tasks/<userId>/<ts>-<name>,
 * comments/<taskId>/..., profiles/..., procurement/<taskId>/...), so a file's key is
 * identical in the bucket and on disk.
 */

export const FILES_ROUTE = '/api/files/'

export type StorageBackend = 'local' | 'oss'

export function storageBackend(): StorageBackend {
  const v = (process.env.STORAGE_BACKEND || 'local').trim().toLowerCase()
  if (v !== 'local' && v !== 'oss') {
    throw new Error(`STORAGE_BACKEND must be "local" or "oss", got "${process.env.STORAGE_BACKEND}"`)
  }
  return v
}

/** Defaults to public/uploads/files: already a persistent bind mount on the server. */
export function storageDir(): string {
  return process.env.STORAGE_DIR || path.join(process.cwd(), 'public', 'uploads', 'files')
}

export function ossConfigured(): boolean {
  return Boolean(
    process.env.OSS_REGION && process.env.OSS_BUCKET &&
    process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET
  )
}

// Every key the upload routes produce is made of these characters only, so a key
// is the same string raw and URL-encoded, and is safe as a relative path.
const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

export function isSafeKey(key: string): boolean {
  return KEY_RE.test(key) && !key.split('/').some((s) => s === '.' || s === '..')
}

/** File extension reduced to letters and digits, for keys built from a file name. */
export function safeExtension(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  return ext || 'bin'
}

export function linkFor(key: string): string {
  return FILES_ROUTE + key
}

/**
 * The key behind a stored link: the current `/api/files/<key>` form (relative or
 * absolute) or a legacy signed OSS URL `https://<bucket>.<region>.aliyuncs.com/<key>?...`.
 */
export function keyFromLink(url: string | null | undefined): string | null {
  if (!url) return null
  let raw: string | null = null
  const i = url.indexOf(FILES_ROUTE)
  if (i !== -1 && (i === 0 || /^https?:\/\/[^/]+$/.test(url.slice(0, i)))) {
    raw = url.slice(i + FILES_ROUTE.length)
  } else {
    const m = url.match(/^https:\/\/[^/]+\.aliyuncs\.com\/([^?#]+)/)
    if (m) raw = m[1]
  }
  if (!raw) return null
  raw = raw.split(/[?#]/)[0]
  let key: string
  try {
    key = decodeURIComponent(raw)
  } catch {
    return null
  }
  return isSafeKey(key) ? key : null
}

/** True for anything the API should accept as a stored file link. */
export function isFileLink(v: string): boolean {
  if (v.startsWith(FILES_ROUTE)) return isSafeKey(v.slice(FILES_ROUTE.length))
  return /^https?:\/\/[^\s]+$/i.test(v)
}

/** Absolute on-disk path for a key; refuses anything that could leave STORAGE_DIR. */
export function localPath(key: string): string {
  if (!isSafeKey(key)) throw new Error(`unsafe storage key: ${key}`)
  const root = path.resolve(storageDir())
  const p = path.resolve(root, key)
  if (!p.startsWith(root + path.sep)) throw new Error(`storage key escapes the storage folder: ${key}`)
  return p
}

/**
 * Store a new file and return the link to save in the database.
 * Local writes go to a temporary name first and are renamed into place, so a
 * reader can never see a half-written file.
 */
export async function saveFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ url: string; objectKey: string }> {
  if (!isSafeKey(key)) throw new Error(`unsafe storage key: ${key}`)
  if (storageBackend() === 'oss') {
    await uploadToOSS(buffer, key, contentType)
  } else {
    const p = localPath(key)
    await mkdir(path.dirname(p), { recursive: true })
    const tmp = `${p}.part-${randomBytes(6).toString('hex')}`
    await writeFile(tmp, buffer)
    await rename(tmp, p)
  }
  return { url: linkFor(key), objectKey: key }
}

/**
 * Remove a stored file. With the local backend only the local copy is removed: a
 * copy that may still exist in the old bucket is left for whoever retires it.
 * Never throws - cleanup failures must not break the request that triggered them.
 */
export async function deleteFile(key: string | null | undefined): Promise<void> {
  if (!key || !isSafeKey(key)) return
  try {
    await unlink(localPath(key))
  } catch (e: any) {
    if (e?.code !== 'ENOENT') console.error('Error deleting local file:', key, e?.message)
  }
  try {
    if (storageBackend() === 'oss' && ossConfigured()) {
      await deleteFromOSS(key)
    }
  } catch (e: any) {
    console.error('Error deleting stored file:', key, e?.message)
  }
}

/**
 * Open a stored file for streaming: from local disk, or - for a file from before
 * the move that has not been copied yet - straight from the bucket via a fresh
 * short-lived signed URL. Null when it exists in neither place.
 */
export async function openStoredFile(key: string): Promise<{ body: ReadableStream; size?: number } | null> {
  if (!isSafeKey(key)) return null
  try {
    const p = localPath(key)
    const st = await stat(p)
    if (st.isFile()) {
      return { body: Readable.toWeb(createReadStream(p)) as unknown as ReadableStream, size: st.size }
    }
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e
  }
  if (ossConfigured()) {
    const upstream = await fetch(getSignedUrl(key, 300))
    if (upstream.ok && upstream.body) return { body: upstream.body as ReadableStream }
  }
  return null
}
