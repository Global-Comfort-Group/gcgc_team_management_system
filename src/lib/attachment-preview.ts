/**
 * Which attachments can be shown in-app rather than downloaded.
 *
 * Alibaba OSS serves from its default endpoint with `Content-Disposition:
 * attachment` and `x-oss-force-download`, so navigating to an attachment URL
 * saves the file instead of displaying it. Anything previewable therefore has
 * to be rendered inside the page — an `<img>` or an `<iframe>` — never opened
 * by URL. See the comment lightbox in TaskViewModal, which exists for the same
 * reason.
 *
 * MIME type is trusted when present, because it comes from the upload. It often
 * isn't: `fileType` is nullable on TaskAttachment and older rows have nothing.
 * The filename extension is the fallback.
 */

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']

function extensionOf(fileName: string | null | undefined): string {
  if (!fileName) return ''
  // Ignore any query string an OSS URL may carry, then take the last dot.
  const clean = fileName.split('?')[0].split('#')[0]
  const dot = clean.lastIndexOf('.')
  return dot === -1 ? '' : clean.slice(dot).toLowerCase()
}

/** True for something an `<img>` can render. */
export function isImageAttachment(
  fileType: string | null | undefined,
  fileName?: string | null
): boolean {
  if (fileType && fileType.toLowerCase().startsWith('image/')) return true
  return IMAGE_EXTENSIONS.includes(extensionOf(fileName))
}

/** True for a PDF, which an `<iframe>` can usually render. */
export function isPdfAttachment(
  fileType: string | null | undefined,
  fileName?: string | null
): boolean {
  if (fileType && fileType.toLowerCase() === 'application/pdf') return true
  return extensionOf(fileName) === '.pdf'
}

/**
 * True when the file is worth opening a preview for at all. Everything else
 * keeps its plain download behaviour — offering a preview that renders a blank
 * frame is worse than not offering one.
 */
export function isPreviewable(
  fileType: string | null | undefined,
  fileName?: string | null
): boolean {
  return isImageAttachment(fileType, fileName) || isPdfAttachment(fileType, fileName)
}
