import { Clock, Calendar, CheckCircle2, Circle } from 'lucide-react'

const PRIORITY_LABELS = { high: 'HIGH', medium: 'MED', low: 'LOW' }

export function TaskCard({ task }) {
  const { title, priority, duration_minutes, suggested_start, status } = task
  const scheduled = status === 'scheduled'

  return (
    <div className={`task-card priority-${priority}${scheduled ? ' done' : ''}`}>
      <div className="tc-header">
        <span className={`priority-badge ${priority}`}>
          {PRIORITY_LABELS[priority] ?? priority.toUpperCase()}
        </span>
        <span className="tc-status" title={status}>
          {scheduled ? <CheckCircle2 size={13} /> : <Circle size={13} />}
        </span>
      </div>

      <div className="tc-title">{title}</div>

      <div className="tc-meta">
        <span>
          <Clock size={11} />
          {duration_minutes < 60
            ? `${duration_minutes}m`
            : `${duration_minutes / 60}h`}
        </span>

        {suggested_start && (
          <span>
            <Calendar size={11} />
            {new Date(suggested_start).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  )
}
