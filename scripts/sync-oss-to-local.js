/**
 * Copies every object in the Alibaba OSS bucket into local storage, so uploads made
 * before the move to local storage are on this server too.
 *
 * Runs in the background a few seconds after the server starts (see server.js),
 * and can also be run by hand:  node scripts/sync-oss-to-local.js
 *
 *   - only when STORAGE_BACKEND is local (the default) and the OSS_* settings exist;
 *     otherwise it logs why and does nothing
 *   - READ-ONLY on the bucket: lists and downloads, never writes or deletes
 *   - idempotent: a file already on disk at the bucket's size is skipped, so every
 *     later start costs one bucket listing and nothing else
 *   - every download is checked against the bucket's MD5 (its ETag) before it is
 *     moved into place under its own key; a mismatch is retried, never kept
 *
 * Until a file has been copied, /api/files/<key> falls back to a short-lived signed
 * bucket link, so users never see a gap.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const isSafeKey = (k) => KEY_RE.test(k) && !k.split('/').some((s) => s === '.' || s === '..')
const log = (m) => console.log(`[storage-sync] ${m}`)

function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

async function run() {
  const backend = (process.env.STORAGE_BACKEND || 'local').trim().toLowerCase()
  if (backend !== 'local') return log(`skipped: STORAGE_BACKEND is ${backend}`)
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    return log('skipped: no OSS settings, nothing to copy from')
  }
  const root = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), 'public', 'uploads', 'files'))
  const OSS = require('ali-oss')
  const client = new OSS({
    region: OSS_REGION, bucket: OSS_BUCKET, accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET, internal: process.env.OSS_USE_INTERNAL === 'true',
    secure: true, timeout: 120000,
  })

  const objects = []
  let token
  do {
    const r = await client.listV2({ 'max-keys': 1000, 'continuation-token': token })
    for (const o of r.objects || []) {
      if (o.name.endsWith('/') && Number(o.size) === 0) continue // console "folder" placeholders
      objects.push({ key: o.name, size: Number(o.size), etag: String(o.etag).replace(/"/g, '').toLowerCase() })
    }
    token = r.isTruncated ? r.nextContinuationToken : null
  } while (token)

  let present = 0, copied = 0, bytes = 0
  const failed = [], skipped = []
  for (const o of objects) {
    if (!isSafeKey(o.key)) { skipped.push(o.key); continue }
    const dest = path.join(root, ...o.key.split('/'))
    try {
      if (fs.statSync(dest).size === o.size) { present++; continue }
    } catch { /* not there yet */ }

    let lastErr = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const part = `${dest}.part-${crypto.randomBytes(6).toString('hex')}`
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        await client.get(o.key, part)
        const size = fs.statSync(part).size
        if (size !== o.size) throw new Error(`size ${size} != ${o.size}`)
        if (!o.etag.includes('-')) {
          const m = await md5File(part)
          if (m !== o.etag) throw new Error(`MD5 ${m} != ETag ${o.etag}`)
        }
        fs.renameSync(part, dest)
        copied++; bytes += o.size; lastErr = null
        break
      } catch (e) {
        lastErr = e
        try { fs.rmSync(part, { force: true }) } catch {}
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }
    if (lastErr) failed.push(`${o.key}: ${lastErr.code || lastErr.message}`)
  }

  log(`bucket ${OSS_BUCKET}: ${objects.length} objects; already here ${present}; copied ${copied} ` +
      `(${(bytes / 1048576).toFixed(1)} MB, MD5-checked); failed ${failed.length}; unsafe keys skipped ${skipped.length}`)
  for (const f of failed.slice(0, 10)) log(`  failed: ${f}`)
  for (const s of skipped.slice(0, 10)) log(`  unsafe key not copied: ${s}`)
  return { objects: objects.length, present, copied, failed: failed.length, skipped: skipped.length }
}

module.exports = { run }

if (require.main === module) {
  run().then((r) => process.exit(r && (r.failed || r.skipped) ? 1 : 0))
    .catch((e) => { console.error('[storage-sync] failed:', e.code || '', e.message); process.exit(1) })
}
