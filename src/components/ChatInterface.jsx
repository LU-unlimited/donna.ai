import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import { VoiceButton } from './VoiceButton'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { streamChatCompletion } from '../services/anthropic'
import { createEvent } from '../services/googleCalendar'

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------
function buildSystemPrompt(eventsForPrompt) {
  const now = new Date()
  const dateStr = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  return `You are Donna, an intelligent personal scheduling assistant. You help users manage their time by analyzing tasks, estimating durations, and scheduling them optimally in Google Calendar.

Today: ${dateStr}

## User's Calendar — Next 14 Days
${eventsForPrompt || 'Calendar not connected or no upcoming events.'}

## Your Job
When the user mentions a task or asks you to schedule something:
1. **Understand** — what needs doing, any deadline, context
2. **Estimate** — realistic duration based on task complexity
3. **Prioritize** — high / medium / low based on urgency and importance
4. **Find a slot** — look at the calendar above, pick the best free window that fits; avoid clashing with existing events
5. **Compose the event** — clear title, rich description, location if relevant

When you've identified a task to schedule, embed EXACTLY ONE JSON block like this:

\`\`\`json
{
  "action": "schedule_task",
  "task": {
    "title": "Concise event title",
    "description": "What to accomplish, relevant context, acceptance criteria",
    "location": "Room / address / 'Virtual' — omit if irrelevant",
    "duration_minutes": 60,
    "priority": "high",
    "suggested_start": "2025-04-01T14:00:00",
    "suggested_end": "2025-04-01T15:00:00"
  }
}
\`\`\`

Priority guide:
- **high** → deadline, client-facing, urgent — schedule ASAP
- **medium** → important but flexible — within 1–3 days
- **low** → nice-to-have, personal growth — fill natural gaps

Be warm, professional, and concise — like a brilliant executive assistant.`
}

// ---------------------------------------------------------------------------
// JSON parser — extracts the schedule_task payload from Claude's response
// ---------------------------------------------------------------------------
function parseTaskSuggestion(content) {
  const match = content.match(/```json([\s\S]*?)```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1].trim())
    if (parsed.action === 'schedule_task' && parsed.task) {
      return { ...parsed.task, id: `task-${Date.now()}` }
    }
  } catch {
    // ignore malformed JSON
  }
  return null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ChatInterface({
  eventsForPrompt,
  isCalendarConnected,
  onTaskAdded,
  onEventsRefresh,
}) {
  const greeting = isCalendarConnected
    ? "I can see your calendar and I'm ready to help you schedule efficiently."
    : "Connect your Google Calendar above so I can find the perfect slots — or just tell me what you need and I'll suggest times."

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm **Donna**, your scheduling assistant. ${greeting}\n\nWhat would you like to get done today?`,
    },
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [input])

  const { isListening, isSupported, startListening, stopListening } =
    useSpeechRecognition({
      onResult: (transcript) =>
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript)),
    })

  // ---------------------------------------------------------------------------
  // Send message → stream Claude response
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    async (text) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      const userMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
      const assistantId = `a-${Date.now() + 1}`

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '' },
      ])
      setInput('')
      setIsStreaming(true)

      try {
        // Build conversation history (exclude the empty assistant placeholder)
        const history = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }))

        let fullContent = ''
        const systemPrompt = buildSystemPrompt(eventsForPrompt)

        for await (const chunk of streamChatCompletion(history, systemPrompt)) {
          fullContent += chunk
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: fullContent } : m
            )
          )
        }

        // Parse optional task suggestion
        const taskSuggestion = parseTaskSuggestion(fullContent)
        if (taskSuggestion) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, taskSuggestion, status: 'pending' }
                : m
            )
          )
          onTaskAdded({ ...taskSuggestion, status: 'pending' })
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Sorry, something went wrong: ${err.message}`,
                }
              : m
          )
        )
      } finally {
        setIsStreaming(false)
      }
    },
    [messages, isStreaming, eventsForPrompt, onTaskAdded]
  )

  // ---------------------------------------------------------------------------
  // Schedule confirmed task → create Google Calendar event
  // ---------------------------------------------------------------------------
  const handleScheduleTask = useCallback(
    async (task) => {
      if (!isCalendarConnected) {
        alert('Please connect Google Calendar first.')
        return
      }

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const colorId =
        task.color_id ??
        (task.priority === 'high'
          ? '11'
          : task.priority === 'medium'
          ? '6'
          : '7')

      const eventBody = {
        summary: task.title,
        description: task.description ?? '',
        ...(task.location ? { location: task.location } : {}),
        start: { dateTime: task.suggested_start, timeZone: tz },
        end: { dateTime: task.suggested_end, timeZone: tz },
        colorId,
      }

      try {
        await createEvent(eventBody)

        // Mark message as scheduled
        setMessages((prev) =>
          prev.map((m) =>
            m.taskSuggestion?.id === task.id ? { ...m, status: 'scheduled' } : m
          )
        )
        onTaskAdded({ ...task, status: 'scheduled' })
        if (onEventsRefresh) await onEventsRefresh()

        const when = new Date(task.suggested_start).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        setMessages((prev) => [
          ...prev,
          {
            id: `confirm-${Date.now()}`,
            role: 'assistant',
            content: `Done! **"${task.title}"** is now on your calendar for ${when}. Anything else you'd like to schedule?`,
          },
        ])
      } catch (err) {
        alert(`Failed to create event: ${err.message}`)
      }
    },
    [isCalendarConnected, onTaskAdded, onEventsRefresh]
  )

  const handleSubmit = (e) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="chat-interface">
      <div className="messages">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onScheduleTask={handleScheduleTask}
          />
        ))}

        {isStreaming && (
          <div className="message assistant">
            <div className="msg-avatar">D</div>
            <div className="typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <VoiceButton
          isListening={isListening}
          isSupported={isSupported}
          onStart={startListening}
          onStop={stopListening}
        />

        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isListening
              ? 'Listening…'
              : 'Tell Donna what you need to schedule…'
          }
          rows={1}
          disabled={isStreaming}
        />

        <button
          type="submit"
          className="send-btn"
          disabled={!input.trim() || isStreaming}
          aria-label="Send message"
        >
          {isStreaming ? (
            <Loader2 size={18} className="spin" />
          ) : (
            <Send size={18} />
          )}
        </button>
      </form>
    </div>
  )
}
