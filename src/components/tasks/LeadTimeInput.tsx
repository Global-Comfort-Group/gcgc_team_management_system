'use client'
import { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type LeadUnit, splitHours, toHours, describeHours, MAX_REMINDERS } from '@/lib/reminder-hours'

function AmountAndUnit({
  amount, unit, onAmount, onUnit, placeholder, onEnter, id,
}: {
  amount: string; unit: LeadUnit; onAmount: (v: string) => void; onUnit: (u: LeadUnit) => void
  placeholder: string; onEnter?: () => void; id?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={amount}
        placeholder={placeholder}
        onChange={(e) => onAmount(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } }}
        className="h-9 w-24"
      />
      <Select value={unit} onValueChange={(v) => onUnit(v as LeadUnit)}>
        <SelectTrigger className="h-9 w-[104px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="hours">hours</SelectItem>
          <SelectItem value="days">days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** One duration in hours (the SLA target). Empty means "no SLA". */
export function SlaInput({ value, onChange, id }: { value: number | null | undefined; onChange: (hours: number | null) => void; id?: string }) {
  const initial = value ? splitHours(value) : null
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [unit, setUnit] = useState<LeadUnit>(initial?.unit ?? 'hours')
  // Re-sync when the form is reset (opening another task, applying a template).
  useEffect(() => {
    const cur = toHours(amount, unit)
    if ((value ?? null) !== cur) {
      const s = value ? splitHours(value) : null
      setAmount(s ? String(s.amount) : '')
      if (s) setUnit(s.unit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const commit = (a: string, u: LeadUnit) => { setAmount(a); setUnit(u); onChange(a.trim() === '' ? null : toHours(a, u)) }
  const invalid = amount.trim() !== '' && toHours(amount, unit) === null
  return (
    <div className="space-y-1">
      <AmountAndUnit id={id} amount={amount} unit={unit} placeholder="e.g. 24" onAmount={(a) => commit(a, unit)} onUnit={(u) => commit(amount, u)} />
      <p className={`text-[11px] ${invalid ? 'text-red-600' : 'text-muted-foreground'}`}>
        {invalid ? 'Enter a whole number greater than 0.' : 'How long the task should take from when it is created. Leave blank for no SLA.'}
      </p>
    </div>
  )
}

/** A list of reminders, each "N hours/days before the due date". */
export function RemindersInput({ value, onChange, hasDueDate }: { value: number[]; onChange: (hours: number[]) => void; hasDueDate: boolean }) {
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<LeadUnit>('days')
  const hours = toHours(amount, unit)
  const add = () => {
    if (hours === null || value.includes(hours) || value.length >= MAX_REMINDERS) return
    onChange([...value, hours].sort((a, b) => b - a))
    setAmount('')
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <AmountAndUnit amount={amount} unit={unit} placeholder="e.g. 2" onAmount={setAmount} onUnit={setUnit} onEnter={add} />
        <span className="text-sm text-muted-foreground">before the due date</span>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={add} disabled={hours === null || value.length >= MAX_REMINDERS}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((h) => (
            <span key={h} className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
              {describeHours(h)} before
              <button type="button" aria-label={`Remove ${describeHours(h)} reminder`} onClick={() => onChange(value.filter((x) => x !== h))} className="text-purple-400 hover:text-purple-700">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {hasDueDate
          ? 'Assignees get an in-app notification and an email at each reminder.'
          : 'Reminders are sent only once the task has a due date.'}
      </p>
    </div>
  )
}
