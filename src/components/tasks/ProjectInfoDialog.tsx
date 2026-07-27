'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { resolveBoardActual } from '@/lib/board-progress'

interface Measurement { name: string; weight: number; progress: number }
interface QuarterRow { quarter: number; targetPercent: number; actualPercent: number | null }

interface Props {
  boardId: string
  boardName: string
  boardColor: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

const YEAR = new Date().getFullYear()
const CURRENT_Q = Math.floor(new Date().getMonth() / 3) + 1

function statusOf(progress: number): { label: string; className: string } {
  if (progress >= 100) return { label: 'Done', className: 'bg-emerald-100 text-emerald-700' }
  if (progress > 0) return { label: 'Ongoing', className: 'bg-amber-100 text-amber-700' }
  return { label: 'Not started', className: 'bg-slate-100 text-slate-500' }
}

function Ring({ percent, color }: { percent: number; color: string }) {
  const size = 76, stroke = 7, r = (size - stroke) / 2, c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(100, percent)) / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-bold text-slate-800 tabular-nums">{percent}%</span>
    </div>
  )
}

export default function ProjectInfoDialog({ boardId, boardName, boardColor, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [taskAverage, setTaskAverage] = useState(0)
  const [manualMode, setManualMode] = useState(false)
  const [manualActual, setManualActual] = useState(0)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [quarters, setQuarters] = useState<QuarterRow[]>([])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/boards/${boardId}/project-info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setCanManage(!!d.canManage)
        setTaskAverage(d.taskAveragePercent ?? 0)
        setManualMode(d.manualActualPercent != null)
        setManualActual(d.manualActualPercent ?? d.actualPercent ?? 0)
        setMeasurements((d.measurements ?? []).map((m: any) => ({ name: m.name, weight: m.weight, progress: m.progress })))
        const byQ = new Map<number, any>((d.quarterTargets ?? []).filter((q: any) => q.year === YEAR).map((q: any) => [q.quarter, q]))
        setQuarters([1, 2, 3, 4].map((q) => ({
          quarter: q,
          targetPercent: byQ.get(q)?.targetPercent ?? 0,
          actualPercent: byQ.get(q)?.actualPercent ?? null,
        })))
      })
      .finally(() => setLoading(false))
  }, [open, boardId])

  // Live preview of the actual %, mirroring the server's resolveBoardActual.
  const previewActual = resolveBoardActual({
    manualActualPercent: manualMode ? manualActual : null,
    measurements,
    taskAveragePercent: taskAverage,
  })
  const totalWeight = measurements.reduce((a, m) => a + (Number(m.weight) || 0), 0)

  const setMeasure = (i: number, patch: Partial<Measurement>) =>
    setMeasurements((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  const setQuarter = (q: number, patch: Partial<QuarterRow>) =>
    setQuarters((prev) => prev.map((row) => (row.quarter === q ? { ...row, ...patch } : row)))

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/project-info`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manualActualPercent: manualMode ? Math.max(0, Math.min(100, Math.round(manualActual))) : null,
          measurements: measurements
            .filter((m) => m.name.trim())
            .map((m) => ({ name: m.name.trim(), weight: Math.max(0, Math.min(100, Math.round(Number(m.weight) || 0))), progress: Math.max(0, Math.min(100, Math.round(Number(m.progress) || 0))) })),
          quarterTargets: quarters.map((q) => ({
            year: YEAR,
            quarter: q.quarter,
            targetPercent: Math.max(0, Math.min(100, Math.round(q.targetPercent) || 0)),
            actualPercent: q.actualPercent == null ? null : Math.max(0, Math.min(100, Math.round(q.actualPercent))),
          })),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed')
      toast({ title: 'Project info saved' })
      onSaved?.()
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project info</DialogTitle>
          <DialogDescription>{boardName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="space-y-6">
            {/* Actual completion */}
            <div className="flex items-center gap-4 rounded-xl border p-4" style={{ background: `linear-gradient(120deg, ${boardColor}12, transparent 65%)` }}>
              <Ring percent={previewActual} color={boardColor} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Actual completion</p>
                <p className="text-sm text-slate-600">
                  {manualMode ? 'Entered manually' : measurements.length > 0 ? 'From weighted measurements' : 'From completed tasks'}
                </p>
                {canManage && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={manualMode} onChange={(e) => setManualMode(e.target.checked)} className="h-3.5 w-3.5" />
                      Set actual manually
                    </label>
                    {manualMode && (
                      <div className="flex items-center gap-1">
                        <Input type="number" min={0} max={100} value={manualActual}
                          onChange={(e) => setManualActual(Number(e.target.value))} className="h-7 w-20 text-sm" />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Measurements */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800">Measurements</h4>
                <span className={`text-xs font-medium ${totalWeight === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  Weights total {totalWeight}%
                </span>
              </div>
              {measurements.length === 0 && (
                <p className="text-xs text-slate-500">No measurements yet. {canManage ? 'Add phases below (e.g. BRD/BRS 10%, Development 40%).' : 'Actual falls back to completed-task progress.'}</p>
              )}
              <div className="space-y-2">
                {measurements.map((m, i) => {
                  const st = statusOf(Number(m.progress) || 0)
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-lg border p-2">
                      {canManage ? (
                        <>
                          <Input value={m.name} placeholder="Phase name" maxLength={80} onChange={(e) => setMeasure(i, { name: e.target.value })} className="h-8 flex-1 text-sm" />
                          <div className="flex items-center gap-1 shrink-0">
                            <Input type="number" min={0} max={100} value={m.weight} onChange={(e) => setMeasure(i, { weight: Number(e.target.value) })} className="h-8 w-16 text-sm" title="Weight %" />
                            <span className="text-xs text-slate-400">wt%</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Input type="number" min={0} max={100} value={m.progress} onChange={(e) => setMeasure(i, { progress: Number(e.target.value) })} className="h-8 w-16 text-sm" title="Progress %" />
                            <span className="text-xs text-slate-400">%</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0" onClick={() => setMeasurements((prev) => prev.filter((_, idx) => idx !== i))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{m.name}</p>
                            <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, m.progress))}%`, backgroundColor: boardColor }} />
                            </div>
                          </div>
                          <span className="text-xs text-slate-500 shrink-0 w-12 text-right">{m.weight}%</span>
                          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0 ${st.className}`}>{st.label}</span>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              {canManage && (
                <Button variant="outline" size="sm" className="mt-1" onClick={() => setMeasurements((prev) => [...prev, { name: '', weight: 0, progress: 0 }])}>
                  <Plus className="h-4 w-4 mr-1.5" /> Add measurement
                </Button>
              )}
            </section>

            {/* Quarterly */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-800">Quarterly target vs actual · {YEAR}</h4>
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1.5 items-center text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400"></span>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Target</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actual</span>
                {quarters.map((q) => {
                  const liveActual = q.quarter === CURRENT_Q ? previewActual : null
                  const actualDisplay = q.actualPercent != null ? q.actualPercent : liveActual
                  return (
                    <FragmentRow key={q.quarter}>
                      <span className="font-medium text-slate-700">Q{q.quarter}{q.quarter === CURRENT_Q ? ' ·' : ''}</span>
                      {canManage ? (
                        <div className="flex items-center gap-1">
                          <Input type="number" min={0} max={100} value={q.targetPercent} onChange={(e) => setQuarter(q.quarter, { targetPercent: Number(e.target.value) })} className="h-7 w-20 text-sm" />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      ) : (
                        <span className="text-slate-700">{q.targetPercent}%</span>
                      )}
                      {canManage ? (
                        <div className="flex items-center gap-1">
                          <Input type="number" min={0} max={100}
                            value={actualDisplay ?? ''}
                            placeholder={liveActual != null ? String(liveActual) : '—'}
                            onChange={(e) => setQuarter(q.quarter, { actualPercent: e.target.value === '' ? null : Number(e.target.value) })}
                            className="h-7 w-20 text-sm" />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      ) : (
                        <span className="text-slate-700">{actualDisplay != null ? `${actualDisplay}%` : '—'}</span>
                      )}
                    </FragmentRow>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-400">The current quarter&apos;s Actual pre-fills from the live project %. Leave blank to keep it live.</p>
            </section>

            {canManage && (
              <div className="flex justify-end gap-2 pt-1 border-t">
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Small helper so the CSS grid rows read cleanly (three cells per quarter).
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
