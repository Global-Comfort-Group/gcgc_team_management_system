interface BoardProgressSummaryProps {
  percent: number
  boardName: string
  color: string
  taskCount: number
}

// Compact "project progress" card for a kanban board: a donut completion ring
// (tinted with the board's own color) beside the board name and task count.
// The ring is the focal element; everything else stays quiet.
export function BoardProgressSummary({ percent, boardName, color, taskCount }: BoardProgressSummaryProps) {
  const pct = Math.max(0, Math.min(100, percent))
  const size = 60
  const stroke = 6
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - pct / 100)

  return (
    <div
      className="flex items-center gap-4 rounded-xl border border-slate-200 px-4 py-3 w-full sm:max-w-md shadow-sm"
      style={{ background: `linear-gradient(120deg, ${color}14, transparent 65%)` }}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-sm font-bold text-slate-800 tabular-nums">
          {pct}%
        </span>
      </div>

      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Project progress</p>
        <p className="text-sm font-semibold text-slate-800 truncate" title={boardName}>{boardName}</p>
        <p className="text-xs text-slate-500">
          {pct === 100 ? 'All tasks complete' : `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} on this board`}
        </p>
      </div>
    </div>
  )
}

export default BoardProgressSummary
