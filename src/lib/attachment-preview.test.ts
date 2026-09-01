import { describe, it, expect } from 'vitest'
import { isImageAttachment, isPdfAttachment, isPreviewable } from './attachment-preview'

describe('isImageAttachment', () => {
  it('trusts an image MIME type', () => {
    expect(isImageAttachment('image/png', 'whatever.bin')).toBe(true)
  })

  it('falls back to the extension when the type is missing', () => {
    // fileType is nullable and older attachment rows have none.
    expect(isImageAttachment(null, 'screenshot.PNG')).toBe(true)
    expect(isImageAttachment(undefined, 'photo.jpeg')).toBe(true)
  })

  it('ignores a query string on the name or URL', () => {
    expect(isImageAttachment(null, 'shot.png?x-oss-process=style/thumb')).toBe(true)
  })

  it('is false for non-images', () => {
    expect(isImageAttachment('application/pdf', 'report.pdf')).toBe(false)
    expect(isImageAttachment(null, 'notes.txt')).toBe(false)
    expect(isImageAttachment(null, 'archive.zip')).toBe(false)
  })

  it('is false when there is nothing to go on', () => {
    expect(isImageAttachment(null, null)).toBe(false)
    expect(isImageAttachment(null, 'noextension')).toBe(false)
  })

  it('is not fooled by an image word inside the name', () => {
    expect(isImageAttachment(null, 'image-notes.txt')).toBe(false)
  })
})

describe('isPdfAttachment', () => {
  it('detects by MIME type and by extension', () => {
    expect(isPdfAttachment('application/pdf', 'x.bin')).toBe(true)
    expect(isPdfAttachment(null, 'Report.PDF')).toBe(true)
  })

  it('is false for other types', () => {
    expect(isPdfAttachment('image/png', 'a.png')).toBe(false)
    expect(isPdfAttachment(null, 'a.doc')).toBe(false)
  })
})

describe('isPreviewable', () => {
  it('covers images and PDFs', () => {
    expect(isPreviewable('image/webp', 'a.webp')).toBe(true)
    expect(isPreviewable(null, 'a.pdf')).toBe(true)
  })

  it('leaves everything else to plain download', () => {
    // Offering a preview that renders an empty frame is worse than none.
    for (const n of ['a.docx', 'a.xlsx', 'a.zip', 'a.mp4', 'a.csv']) {
      expect(isPreviewable(null, n)).toBe(false)
    }
  })
})
