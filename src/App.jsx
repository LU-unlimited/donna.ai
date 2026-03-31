import { useState, useCallback } from 'react'
import { Calendar, RefreshCw, Wifi, AlertCircle, Info, Smartphone } from 'lucide-react'
import { ChatInterface } from './components/ChatInterface'
import { TaskQueue } from './components/TaskQueue'
import { useGoogleCalendar } from './hooks/useGoogleCalendar'

// ── Setup overlay ────────────────────────────────────────────────────────────
function SetupOverlay() {
  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <div className="setup-icon"><Info size={28} /></div>
        <h2>Setup Required</h2>
        <p>Create a <code>.env</code> file in the project root:</p>
        <pre>{`VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_GOOGLE_CLIENT_ID=123....apps.googleusercontent.com`}</pre>
        <p className="setup-hint">
          See <code>.env.example</code> for full instructions, then run <code>npm run dev</code>.
        </p>
      </div>
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState([])

  const {
    isConnected, isLoading, isGISReady, isNative,
    eventsForPrompt, todayFreeWindows, error,
    connect, refreshEvents,
  } = useGoogleCalendar()

  const hasKey = Boolean(import.meta.env.VITE_ANTHROPIC_API_KEY)

  const handleTaskAdded = useCallback((task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = task; return n }
      return [task, ...prev]
    })
  }, [])

  return (
    <div className="app">
      {!hasKey && <SetupOverlay />}

      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="donna-avatar">D</div>
          <div className="brand-text">
            <span className="brand-name">Donna</span>
            <span className="brand-sub">Scheduling Assistant</span>
          </div>
          {isNative && (
            <span className="native-badge" title="Running as native app">
              <Smartphone size={11} /> App
            </span>
          )}
        </div>

        <div className="header-right">
          {error && (
            <div className="header-error" title={error}>
              <AlertCircle size={13} /> <span>{error}</span>
            </div>
          )}

          {isConnected ? (
            <div className="cal-connected">
              <Wifi size={13} />
              <span>Calendar</span>
              <button className="btn-icon" onClick={refreshEvents} title="Refresh">
                <RefreshCw size={12} />
              </button>
            </div>
          ) : (
            <button
              className="btn-connect"
              onClick={connect}
              disabled={isLoading || (!isNative && !isGISReady)}
            >
              <Calendar size={13} />
              {isLoading ? 'Connecting…' : (!isNative && !isGISReady) ? 'Loading…' : 'Connect Calendar'}
            </button>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="app-main">
        <ChatInterface
          eventsForPrompt={eventsForPrompt}
          todayFreeWindows={todayFreeWindows}
          isCalendarConnected={isConnected}
          onTaskAdded={handleTaskAdded}
          onEventsRefresh={refreshEvents}
        />
        <TaskQueue tasks={tasks} />
      </main>
    </div>
  )
}
