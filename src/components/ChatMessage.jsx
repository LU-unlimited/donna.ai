import ReactMarkdown from 'react-markdown'
import { Calendar, Clock, MapPin, CheckCircle2 } from 'lucide-react'

const PRIORITY_LABELS = { high: 'HIGH', medium: 'MED', low: 'LOW' }

/** Strip the schedule_task JSON block from display content — we show the card instead. */
function stripTaskJson(content) {
  return content
    .replace(/```json[\s\S]*?"action"\s*:\s*"schedule_task"[\s\S]*?```/g, '')
    .trim()
}

function TaskSuggestionCard({ task, status, onSchedule }) {
  const scheduled = status === 'scheduled'

  return (
    <div className={`task-suggestion priority-${task.priority}${scheduled ? ' scheduled' : ''}`}>
      <div className="ts-header">
        <span className={`priority-badge ${task.priority}`}>
          {PRIORITY_LABELS[task.priority] ?? task.priority.toUpperCase()}
        </span>
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
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}

        {task.location && (
          <span>
            <MapPin size={13} />
            {task.location}
          </span>
        )}
      </div>

      {scheduled ? (
        <div className="ts-scheduled">
          <CheckCircle2 size={14} />
          Added to Google Calendar
        </div>
      ) : (
        <button className="btn-add-to-cal" onClick={() => onSchedule(task)}>
          <Calendar size={14} />
          Add to Calendar
        </button>
      )}
    </div>
  )
}

export function ChatMessage({ message, onScheduleTask }) {
  const { role, content, taskSuggestion, status } = message
  const displayContent = taskSuggestion ? stripTaskJson(content) : content

  return (
    <div className={`message ${role}`}>
      {role === 'assistant' && (
        <div className="msg-avatar" aria-hidden="true">
          D
        </div>
      )}

      <div className="msg-body">
        {displayContent && (
          <div className="msg-content">
            <ReactMarkdown>{displayContent}</ReactMarkdown>
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
