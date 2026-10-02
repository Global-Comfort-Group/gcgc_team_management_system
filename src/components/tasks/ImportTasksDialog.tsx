'use client'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { ImportPreview, ImportRow, ImportTask } from '@/lib/task-import'

type Board = { id: string; name: string }
type Result = { row: number; title: string; ok: boolean; error?: string }

/** One parsed row → the body New Task sends (same people mapping as TaskForm). */
function toCreateBody(t: ImportTask, boardId: string) {
  const [first, ...rest] = t.assigneeIds
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    customStatusId: t.customStatusId,
    // Resolved server-side in the app timezone (see /api/tasks/import).
    startDate: t.startDateIso,
    dueDate: t.dueDateIso,
    allDay: true,
    progressPercentage: t.progressPercentage,
    taskType: t.assigneeIds.length > 1 ? 'TEAM' : 'INDIVIDUAL',
    assigneeId: first ?? null, // none listed → the importer, as in New Task
    teamMemberIds: rest,
    collaboratorIds: [],
    boardId,
    fieldValues: t.fieldValues,
  }
}

export function ImportTasksDialog({
  open, onOpenChange, boards, defaultBoardId, onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  boards: Board[]
  defaultBoardId?: string | null
  onImported: () => void
}) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [boardId, setBoardId] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<(ImportPreview & { boardName: string }) | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(0)
  const [results, setResults] = useState<Result[] | null>(null)

  // Reset only when the dialog OPENS. Depending on `boards` here wiped the
  // preview on every background refresh of the page (a new array each render).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setBoardId(defaultBoardId && boards.some((b) => b.id === defaultBoardId) ? defaultBoardId : '')
      setFile(null); setPreview(null); setResults(null); setDone(0)
    }
    wasOpen.current = open
  }, [open, defaultBoardId, boards])

  const read = async (f: File, board: string) => {
    setReading(true); setPreview(null); setResults(null)
    try {
      const body = new FormData()
      body.append('file', f)
      body.append('boardId', board)
      const res = await fetch('/api/tasks/import', { method: 'POST', body })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not read the file')
      setPreview(d)
    } catch (e: any) {
      toast({ title: 'Import', description: e.message, variant: 'destructive' })
    } finally {
      setReading(false)
    }
  }

  const ready = preview?.rows.filter((r) => r.task) ?? []
  const blocked = preview?.rows.filter((r) => !r.task) ?? []

  const runImport = async () => {
    setImporting(true); setDone(0)
    const out: Result[] = []
    for (const r of ready) {
      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toCreateBody(r.task!, boardId)),
        })
        const d = await res.json().catch(() => ({}))
        out.push(res.ok ? { row: r.row, title: r.title, ok: true } : { row: r.row, title: r.title, ok: false, error: d.error || `HTTP ${res.status}` })
      } catch (e: any) {
        out.push({ row: r.row, title: r.title, ok: false, error: e.message })
      }
      setDone(out.length)
    }
    setResults(out)
    setImporting(false)
    const created = out.filter((x) => x.ok).length
    if (created > 0) onImported()
    toast({
      title: `Imported ${created} task${created === 1 ? '' : 's'}`,
      description: out.length - created ? `${out.length - created} row(s) failed — see the list.` : undefined,
      variant: out.length - created ? 'destructive' : undefined,
    })
  }

  const downloadTemplate = () => { if (boardId) window.location.href = `/api/tasks/import/template?boardId=${encodeURIComponent(boardId)}` }

  const Issues = ({ r }: { r: ImportRow }) => (
    <ul className="space-y-0.5">
      {r.errors.map((m, i) => <li key={`e${i}`} className="text-red-600 flex gap-1"><XCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{m}</li>)}
      {r.warnings.map((m, i) => <li key={`w${i}`} className="text-amber-700 flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{m}</li>)}
    </ul>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!importing) onOpenChange(v) }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-green-600" /> Import tasks from Excel</DialogTitle>
          <DialogDescription>
            Use the same columns as Export: Title and Due Date are required; Status, Assignees, Priority, Start Date,
            Progress %, Description and the board&apos;s custom fields are optional. Ticket, Board and Created are ignored —
            every row becomes a new task on the board you pick.
          </DialogDescription>
        </DialogHeader>

        {!results && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label>Board</Label>
                <Select value={boardId || undefined} onValueChange={(v) => { setBoardId(v); if (file) read(file, v) }}>
                  <SelectTrigger><SelectValue placeholder="Choose the board to import into…" /></SelectTrigger>
                  <SelectContent>{boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={downloadTemplate} disabled={!boardId}>
                <Download className="h-4 w-4 mr-2" /> Template
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>File (.xlsx or .csv, up to 2 MB)</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && boardId) read(f, boardId); e.target.value = '' }}
              />
              <Button type="button" variant="outline" className="w-full justify-start" disabled={!boardId || reading} onClick={() => fileRef.current?.click()}>
                {reading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {file ? file.name : boardId ? 'Choose a file…' : 'Choose a board first'}
              </Button>
            </div>

            {preview && (
              <div className="space-y-3">
                {preview.missingRequired.length > 0 ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    The file has no {preview.missingRequired.join(' or ')} column. Check the header row (row 1), or download the template.
                  </p>
                ) : (
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-green-700">{ready.length} ready</span>
                    {blocked.length > 0 && <>, <span className="font-semibold text-red-600">{blocked.length} can&apos;t be imported</span></>}
                    {' '}into <span className="font-semibold">{preview.boardName}</span>.
                    {preview.ignored.length > 0 && <span className="text-muted-foreground"> Not imported: {preview.ignored.join(', ')}.</span>}
                  </p>
                )}
                {preview.rows.length > 0 && (
                  <div className="max-h-[42vh] overflow-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                        <tr><th className="px-2 py-1.5 w-10">Row</th><th className="px-2 py-1.5">Title</th><th className="px-2 py-1.5 w-24">Due</th><th className="px-2 py-1.5">Notes</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {preview.rows.map((r) => (
                          <tr key={r.row} className={r.task ? '' : 'bg-red-50/50'}>
                            <td className="px-2 py-1.5 text-slate-400 tabular-nums">{r.row}</td>
                            <td className="px-2 py-1.5 font-medium text-slate-800">{r.title || <span className="italic text-slate-400">(no title)</span>}</td>
                            <td className="px-2 py-1.5 tabular-nums text-slate-600">{r.task?.dueDate ?? ''}</td>
                            <td className="px-2 py-1.5">{r.errors.length + r.warnings.length > 0 ? <Issues r={r} /> : <span className="text-green-700">OK</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {results && (
          <div className="space-y-2">
            <p className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {results.filter((r) => r.ok).length} of {results.length} created.
            </p>
            {results.some((r) => !r.ok) && (
              <ul className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 space-y-1 max-h-[40vh] overflow-auto">
                {results.filter((r) => !r.ok).map((r) => <li key={r.row}>Row {r.row} “{r.title}”: {r.error}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
              <Button onClick={runImport} disabled={importing || ready.length === 0 || !!preview?.missingRequired.length}>
                {importing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing {done}/{ready.length}…</> : `Import ${ready.length} task${ready.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
