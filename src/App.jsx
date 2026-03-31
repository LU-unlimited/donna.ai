import { useState, useCallback } from 'react'
import { Calendar, RefreshCw, Wifi, AlertCircle, Info } from 'lucide-react'
import { ChatInterface } from './components/ChatInterface'
import { TaskQueue } from './components/TaskQueue'
import { useGoogleCalendar } from './hooks/useGoogleCalendar'

// ---------------------------------------------------------------------------
// Setup overlay — shown when required env vars are missing
// ---------------------------------------------------------------------------
function SetupOverlay() {
  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <div className="setup-icon">
          <Info size={28} />
        </div>
        <h2>Setup Required</h2>
        <p>
          Create a <code>.env</code> file in the project root with the
          following variables:
        </p>
        <pre>{`VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_GOOGLE_CLIENT_ID=123....apps.googleusercontent.com`}</pre>
        <p className="setup-hint">
          See <code>.env.example</code> for detailed instructions, then restart
          with <code>npm run dev</code>.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [tasks, setTasks] = useState([])

  const {
    isConnected,
    isLoading,
    isGISReady,
    eventsForPrompt,
    error,
    connect,
    refreshEvents,
  } = useGoogleCalendar()

  const hasAnthropicKey = Boolean(import.meta.env.VITE_ANTHROPIC_API_KEY)

  const handleTaskAdded = useCallback((task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = task
        return next
      }
      return [task, ...prev]
    })
  }, [])

  return (
    <div className="app">
      {!hasAnthropicKey && <SetupOverlay />}

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-brand">
          <div className="donna-avatar">D</div>
          <div className="brand-text">
            <span className="brand-name">Donna</span>
            <span className="brand-sub">Scheduling Assistant</span>
          </div>
        </div>

        <div className="header-right">
          {error && (
            <div className="header-error" title={error}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {isConnected ? (
            <div className="cal-connected">
              <Wifi size={14} />
              <span>Calendar connected</span>
              <button
                className="btn-icon"
                onClick={refreshEvents}
                title="Refresh calendar"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          ) : (
            <button
              className="btn-connect"
              onClick={connect}
              disabled={isLoading || !isGISReady}
            >
              <Calendar size={14} />
              {isLoading
                ? 'Connecting…'
                : !isGISReady
                ? 'Loading…'
                : 'Connect Google Calendar'}
            </button>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main className="app-main">
        <ChatInterface
          eventsForPrompt={eventsForPrompt}
          isCalendarConnected={isConnected}
          onTaskAdded={handleTaskAdded}
          onEventsRefresh={refreshEvents}
        />
        <TaskQueue tasks={tasks} />
      </main>
    </div>
  )
}
