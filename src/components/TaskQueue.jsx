import { ListTodo } from 'lucide-react'
import { TaskCard } from './TaskCard'

const PRIORITY_ORDER = ['high', 'medium', 'low']
const PRIORITY_LABELS = { high: 'High Priority', medium: 'Medium', low: 'Low' }

export function TaskQueue({ tasks }) {
  const grouped = PRIORITY_ORDER.reduce((acc, p) => {
    acc[p] = tasks.filter((t) => t.priority === p)
    return acc
  }, {})

  return (
    <aside className="task-queue">
      <div className="tq-header">
        <ListTodo size={16} />
        <h2>Task Queue</h2>
        {tasks.length > 0 && (
          <span className="tq-count">{tasks.length}</span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="tq-empty">
          <p>No tasks queued yet.</p>
          <p>Tell Donna what you need to get done.</p>
        </div>
      ) : (
        <div className="tq-list">
          {PRIORITY_ORDER.map((priority) =>
            grouped[priority].length > 0 ? (
              <div key={priority} className="tq-group">
                <div className={`tq-group-label ${priority}`}>
                  {PRIORITY_LABELS[priority]}
                </div>
                {grouped[priority].map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            ) : null
          )}
        </div>
      )}
    </aside>
  )
}
