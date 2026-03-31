import ReactMarkdown from 'react-markdown'
import { Calendar, Clock, MapPin, CheckCircle2, Zap, Tag } from 'lucide-react'

const PRIORITY_LABELS = { high: 'HIGH', medium: 'MED', low: 'LOW' }

const CATEGORY_ICONS = {
  work: '💼', personal: '🏠', health: '🏃', learning: '📚',
  social: '👥', finance: '💰', other: '📌',
}

const ENERGY_LABELS = { high: '⚡ High focus', medium: '🟡 Medium focus', low: '☕ Light focus' }

function TaskSuggestionCard({ task, status, onSchedule }) {
  const scheduled = status === 'scheduled'

  return (
    <div className={`task-suggestion priority-${task.priority}${scheduled ? ' scheduled' : ''}`}>
      <div className="ts-header">
        <span className={`priority-badge ${task.priority}`}>
          {PRIORITY_LABELS[task.priority] ?? task.priority.toUpperCase()}
        </span>
        {task.category && (
          <span className="ts-category">
            {CATEGORY_ICONS[task.category] ?? '📌'} {task.category}
          </span>
        )}
        <span className="ts-title">{task.title}</span>
      </div>

      <div className="ts-details">
        <span>
          <Clock size={13} />
          {task.duration_minutes < 60
            ? `${task.duration_minutes}m`
            : `${task.duration_minutes / 60}h`}
        </span>

        {task.suggested_start && (
          <span>
            <Calendar size={13} />
            {new Date(task.suggested_start).toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}

        {task.location && (
          <span><MapPin size={13} /> {task.location}</span>
        )}

        {task.energy_level && (
          <span><Zap size={13} /> {ENERGY_LABELS[task.energy_level] ?? task.energy_level}</span>
        )}
      </div>

      {task.reasoning && (
        <div className="ts-reasoning">
          <span className="ts-reasoning-label">Why this slot:</span> {task.reasoning}
        </div>
      )}

      {task.description && (
        <div className="ts-description">{task.description}</div>
      )}

      {scheduled ? (
        <div className="ts-scheduled">
          <CheckCircle2 size={14} /> Added to Google Calendar
        </div>
      ) : (
        <button className="btn-add-to-cal" onClick={() => onSchedule(task)}>
          <Calendar size={14} /> Add to Calendar
        </button>
      )}
    </div>
  )
}

export function ChatMessage({ message, onScheduleTask }) {
  const { role, content, taskSuggestion, status } = message

  return (
    <div className={`message ${role}`}>
      {role === 'assistant' && <div className="msg-avatar">D</div>}

      <div className="msg-body">
        {content && (
          <div className="msg-content">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}

        {taskSuggestion && (
          <TaskSuggestionCard
            task={taskSuggestion}
            status={status}
            onSchedule={onScheduleTask}
          />
        )}
      </div>
    </div>
  )
}
