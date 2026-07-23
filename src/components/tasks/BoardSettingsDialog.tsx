'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2, Copy, ExternalLink } from 'lucide-react'

type Category = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED'
type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'

interface BoardStatus {
  id: string
  name: string
  category: Category
  color: string
  position: number
  isDefault: boolean
}
interface BoardField {
  id: string
  name: string
  type: FieldType
  options: string[]
  required: boolean
  position: number
}

interface IntakeForm {
  id: string
  title: string
  intro: string | null
  token: string
  targetStatusId: string | null
  defaultAssigneeId: string | null
  enabled: boolean
}

interface Props {
  boardId: string
  boardName: string
  statuses: BoardStatus[]
  fields: BoardField[]
  members?: Array<{ id: string; name?: string | null; email: string }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  COMPLETED: 'Completed',
}
const TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  SELECT: 'Dropdown',
}

async function call(url: string, method: string, body?: any) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || 'Request failed')
  }
  return res.json().catch(() => ({}))
}

export default function BoardSettingsDialog({ boardId, boardName, statuses, fields, members, open, onOpenChange, onChanged }: Props) {
  const { toast } = useToast()
  const [tab, setTab] = useState<'statuses' | 'fields' | 'forms'>('statuses')
  const [busy, setBusy] = useState(false)

  // Intake forms (fetched when the Forms tab opens)
  const [forms, setForms] = useState<IntakeForm[]>([])
  const [formsLoaded, setFormsLoaded] = useState(false)
  const [nfTitle, setNfTitle] = useState('')
  const [nfIntro, setNfIntro] = useState('')
  const [nfTarget, setNfTarget] = useState<string>('')
  const [nfAssignee, setNfAssignee] = useState<string>('')
  const orderedStatusesForForm = [...statuses].filter((s) => s.category !== 'CANCELLED').sort((a, b) => a.position - b.position)

  const loadForms = async () => {
    try {
      const res = await fetch(`/api/boards/${boardId}/forms`)
      if (res.ok) { setForms((await res.json()).forms || []); setFormsLoaded(true) }
    } catch { /* ignore */ }
  }
  useEffect(() => {
    if (open && tab === 'forms' && !formsLoaded) loadForms()
    if (!open) setFormsLoaded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  // Status add form
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'>('IN_PROGRESS')
  const [newColor, setNewColor] = useState('#6366F1')

  // Field add form
  const [fName, setFName] = useState('')
  const [fType, setFType] = useState<FieldType>('TEXT')
  const [fOptions, setFOptions] = useState('')
  const [fRequired, setFRequired] = useState(false)

  const orderedStatuses = [...statuses].filter((s) => s.category !== 'CANCELLED').sort((a, b) => a.position - b.position)
  const orderedFields = [...fields].sort((a, b) => a.position - b.position)

  const guard = async (fn: () => Promise<void>, errTitle: string) => {
    try {
      setBusy(true)
      await fn()
      onChanged()
    } catch (e: any) {
      toast({ title: errTitle, description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  // ── Statuses ──
  const addStatus = () => {
    if (!newName.trim()) return
    guard(async () => {
      await call(`/api/boards/${boardId}/statuses`, 'POST', { name: newName.trim(), category: newCategory, color: newColor })
      setNewName('')
      toast({ title: 'Status added' })
    }, 'Could not add status')
  }
  const patchStatus = (s: BoardStatus, body: any, t: string) => guard(() => call(`/api/boards/${boardId}/statuses/${s.id}`, 'PATCH', body).then(() => {}), t)
  const delStatus = (s: BoardStatus) => guard(() => call(`/api/boards/${boardId}/statuses/${s.id}`, 'DELETE').then(() => { toast({ title: 'Status deleted' }) }), 'Could not delete')
  const moveStatus = (idx: number, dir: -1 | 1) => {
    const cur = orderedStatuses[idx]; const target = orderedStatuses[idx + dir]
    if (!cur || !target) return
    guard(() => Promise.all([
      call(`/api/boards/${boardId}/statuses/${cur.id}`, 'PATCH', { position: target.position }),
      call(`/api/boards/${boardId}/statuses/${target.id}`, 'PATCH', { position: cur.position }),
    ]).then(() => {}), 'Could not reorder')
  }

  // ── Fields ──
  const addField = () => {
    if (!fName.trim()) return
    const options = fType === 'SELECT' ? fOptions.split(',').map((o) => o.trim()).filter(Boolean) : undefined
    if (fType === 'SELECT' && (!options || options.length === 0)) {
      toast({ title: 'Add at least one option', description: 'Dropdown fields need comma-separated options.', variant: 'destructive' })
      return
    }
    guard(async () => {
      await call(`/api/boards/${boardId}/fields`, 'POST', { name: fName.trim(), type: fType, options, required: fRequired })
      setFName(''); setFOptions(''); setFRequired(false); setFType('TEXT')
      toast({ title: 'Field added' })
    }, 'Could not add field')
  }
  const patchField = (f: BoardField, body: any, t: string) => guard(() => call(`/api/boards/${boardId}/fields/${f.id}`, 'PATCH', body).then(() => {}), t)
  const delField = (f: BoardField) => guard(() => call(`/api/boards/${boardId}/fields/${f.id}`, 'DELETE').then(() => { toast({ title: 'Field deleted' }) }), 'Could not delete')
  const moveField = (idx: number, dir: -1 | 1) => {
    const cur = orderedFields[idx]; const target = orderedFields[idx + dir]
    if (!cur || !target) return
    guard(() => Promise.all([
      call(`/api/boards/${boardId}/fields/${cur.id}`, 'PATCH', { position: target.position }),
      call(`/api/boards/${boardId}/fields/${target.id}`, 'PATCH', { position: cur.position }),
    ]).then(() => {}), 'Could not reorder')
  }

  // ── Intake forms ──
  const formUrl = (token: string) => (typeof window !== 'undefined' ? `${window.location.origin}/forms/${token}` : `/forms/${token}`)
  const copyLink = async (token: string) => {
    try { await navigator.clipboard.writeText(formUrl(token)); toast({ title: 'Link copied' }) }
    catch { toast({ title: 'Copy failed', description: formUrl(token) }) }
  }
  const addForm = () => {
    if (!nfTitle.trim()) return
    guard(async () => {
      await call(`/api/boards/${boardId}/forms`, 'POST', {
        title: nfTitle.trim(),
        intro: nfIntro.trim() || undefined,
        targetStatusId: nfTarget || undefined,
        defaultAssigneeId: nfAssignee || undefined,
      })
      setNfTitle(''); setNfIntro(''); setNfTarget(''); setNfAssignee('')
      await loadForms()
      toast({ title: 'Form created' })
    }, 'Could not create form')
  }
  const patchForm = (f: IntakeForm, body: any, t: string) => guard(() => call(`/api/boards/${boardId}/forms/${f.id}`, 'PATCH', body).then(() => loadForms()), t)
  const delForm = (f: IntakeForm) => guard(() => call(`/api/boards/${boardId}/forms/${f.id}`, 'DELETE').then(() => { loadForms(); toast({ title: 'Form deleted' }) }), 'Could not delete')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
          <DialogDescription>Customize “{boardName}”.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground shrink-0">Board ID</span>
          <code className="flex-1 truncate font-mono text-xs" title={boardId}>{boardId}</code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs shrink-0"
            onClick={async () => {
              try { await navigator.clipboard.writeText(boardId); toast({ title: 'Board ID copied' }) }
              catch { toast({ title: 'Copy failed', description: boardId }) }
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
        </div>

        <div className="inline-flex items-center gap-1 rounded-md border p-0.5 self-start">
          {(['statuses', 'fields', 'forms'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 h-7 rounded text-xs font-semibold capitalize ${tab === t ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'statuses' ? (
          <>
            <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
              {orderedStatuses.map((s, idx) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border p-2">
                  <div className="flex flex-col">
                    <button type="button" disabled={idx === 0 || busy} onClick={() => moveStatus(idx, -1)} className="text-muted-foreground disabled:opacity-30 hover:text-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={idx === orderedStatuses.length - 1 || busy} onClick={() => moveStatus(idx, 1)} className="text-muted-foreground disabled:opacity-30 hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
                  </div>
                  <input type="color" value={s.color} onChange={(e) => patchStatus(s, { color: e.target.value }, 'Could not update color')} className="h-7 w-7 rounded cursor-pointer border bg-transparent" title="Color" />
                  <Input defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) patchStatus(s, { name: v }, 'Could not rename') }} className="h-8 flex-1" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-20 text-right shrink-0">{CATEGORY_LABELS[s.category] ?? s.category}</span>
                  {s.isDefault ? <span className="text-[10px] text-muted-foreground w-14 text-center shrink-0">default</span>
                    : <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0" disabled={busy} onClick={() => delStatus(s)}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Add a status</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-9 w-9 rounded cursor-pointer border bg-transparent" title="Color" />
                <Input placeholder="Status name…" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addStatus() }} className="flex-1" />
                <Select value={newCategory} onValueChange={(v) => setNewCategory(v as any)}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={addStatus} disabled={!newName.trim() || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Category controls behavior: a “Completed” status needs finisher permission; “In Review” sets 90% progress.</p>
            </div>
          </>
        ) : tab === 'fields' ? (
          <>
            <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
              {orderedFields.length === 0 && <p className="text-xs text-muted-foreground py-2">No custom fields yet. Add one below.</p>}
              {orderedFields.map((f, idx) => (
                <div key={f.id} className="rounded-lg border p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button type="button" disabled={idx === 0 || busy} onClick={() => moveField(idx, -1)} className="text-muted-foreground disabled:opacity-30 hover:text-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button type="button" disabled={idx === orderedFields.length - 1 || busy} onClick={() => moveField(idx, 1)} className="text-muted-foreground disabled:opacity-30 hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <Input defaultValue={f.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f.name) patchField(f, { name: v }, 'Could not rename') }} className="h-8 flex-1" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-16 text-right shrink-0">{TYPE_LABELS[f.type]}</span>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                      <input type="checkbox" checked={f.required} disabled={busy} onChange={(e) => patchField(f, { required: e.target.checked }, 'Could not update')} className="h-3 w-3" />req
                    </label>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0" disabled={busy} onClick={() => delField(f)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {f.type === 'SELECT' && (
                    <Input defaultValue={f.options.join(', ')} placeholder="Options (comma-separated)"
                      onBlur={(e) => { const opts = e.target.value.split(',').map((o) => o.trim()).filter(Boolean); if (opts.length && opts.join(',') !== f.options.join(',')) patchField(f, { options: opts }, 'Could not update options') }}
                      className="h-7 text-xs" />
                  )}
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Add a field</Label>
              <div className="flex items-center gap-2">
                <Input placeholder="Field name…" value={fName} maxLength={40} onChange={(e) => setFName(e.target.value)} className="flex-1" />
                <Select value={fType} onValueChange={(v) => setFType(v as FieldType)}>
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={addField} disabled={!fName.trim() || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
              </div>
              {fType === 'SELECT' && (
                <Input placeholder="Options (comma-separated, e.g. Low, Medium, High)" value={fOptions} onChange={(e) => setFOptions(e.target.value)} className="text-xs" />
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={fRequired} onChange={(e) => setFRequired(e.target.checked)} className="h-3 w-3" /> Required
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
              {!formsLoaded && <p className="text-xs text-muted-foreground py-2">Loading…</p>}
              {formsLoaded && forms.length === 0 && <p className="text-xs text-muted-foreground py-2">No intake forms yet. Create one below to collect requests via a public link.</p>}
              {forms.map((f) => (
                <div key={f.id} className="rounded-lg border p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input defaultValue={f.title} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f.title) patchForm(f, { title: v }, 'Could not rename') }} className="h-8 flex-1" />
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                      <input type="checkbox" checked={f.enabled} disabled={busy} onChange={(e) => patchForm(f, { enabled: e.target.checked }, 'Could not update')} className="h-3 w-3" />on
                    </label>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0" disabled={busy} onClick={() => delForm(f)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={formUrl(f.token)} className="h-7 text-xs flex-1 bg-muted/40" onFocus={(e) => e.target.select()} />
                    <Button type="button" variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyLink(f.token)} title="Copy link"><Copy className="h-3.5 w-3.5" /></Button>
                    <a href={formUrl(f.token)} target="_blank" rel="noreferrer" className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border hover:bg-muted" title="Open"><ExternalLink className="h-3.5 w-3.5" /></a>
                  </div>
                  {!f.enabled && <p className="text-[10px] text-amber-600">Disabled — the link shows “form not available”.</p>}
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Create an intake form</Label>
              <Input placeholder="Form title… (e.g. Support request)" value={nfTitle} maxLength={80} onChange={(e) => setNfTitle(e.target.value)} />
              <Input placeholder="Intro text shown to submitters (optional)" value={nfIntro} maxLength={500} onChange={(e) => setNfIntro(e.target.value)} />
              <div className="flex items-center gap-2">
                <Select value={nfTarget || 'none'} onValueChange={(v) => setNfTarget(v === 'none' ? '' : v)}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Lands in column…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">First column (default)</SelectItem>
                    {orderedStatusesForForm.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={nfAssignee || 'none'} onValueChange={(v) => setNfAssignee(v === 'none' ? '' : v)}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Board owner</SelectItem>
                    {(members || []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={addForm} disabled={!nfTitle.trim() || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Anyone with the link can submit (no login). The form asks for the submitter’s name + email and your board’s custom fields, then creates a task here.</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
