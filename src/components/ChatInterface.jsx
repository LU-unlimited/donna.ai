import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, CalendarCheck } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import { VoiceButton } from './VoiceButton'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { streamChatCompletion, nativeChatCompletion, isNative } from '../services/anthropic'
import { createEvent } from '../services/googleCalendar'

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(eventsForPrompt, todayFreeWindows) {
  const now = new Date()
  const dateStr = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })

  const freeWindowsStr = todayFreeWindows?.length
    ? todayFreeWindows
        .map((w) => `  • ${w.start}–${w.end} (${w.minutes}m)`)
        .join('\n')
    : '  No calculated free windows available yet.'

  return `You are Donna, an elite personal scheduling assistant with deep expertise in time management, productivity, and calendar optimization.

**Current date/time:** ${dateStr}

## Calendar Context
${eventsForPrompt || 'Calendar not connected — suggest connecting for smarter scheduling.'}

## Pre-calculated Free Windows (Today)
${freeWindowsStr}

## Intelligence Framework

### Task Analysis
When the user describes a task, analyze:
- **Complexity signals**: keywords like "quick", "simple" → 15–30m; "deep work", "research", "prepare" → 60–180m; "meeting", "call" → 30–60m
- **Urgency signals**: "today", "urgent", "ASAP", "deadline" → high priority; "sometime", "eventually" → low
- **Energy requirements**: creative/analytical work → morning (high energy); admin, emails, reviews → afternoon
- **Context switches**: avoid scheduling focus work immediately after/before meetings

### Scheduling Intelligence
When picking a time slot:
1. **Respect existing events** — never overlap with calendar events above
2. **Protect focus time** — don't fragment long blocks (e.g., don't schedule 30m in the middle of a 3h free window unless there's no alternative)
3. **Energy matching** — high-energy tasks (design, coding, writing) → before 12:00; low-energy tasks (admin, review) → after 14:00
4. **Buffer time** — leave 10–15m buffer before/after meetings
5. **Deadlines first** — if user mentions a deadline, schedule with enough lead time
6. **Batching** — suggest grouping similar tasks (e.g., "all calls on Tuesday afternoon")

### Priority Guidelines
- **high** → must happen today or has external deadline/stakeholder impact
- **medium** → important but can shift 1–2 days without consequence
- **low** → would be nice, has no hard deadline, can fill natural gaps

### Response Style
- Be conversational and direct — one or two sentences before the schedule suggestion
- If the request is ambiguous about timing, ask one clarifying question
- When scheduling, always explain *why* you chose that specific slot in the reasoning field
- If no calendar is connected, still suggest a realistic time and explain the logic

**Call the \`schedule_task\` tool when you've determined the optimal slot.** Do not produce markdown JSON blocks — use the tool instead.`
}

// ─── Native response parser (non-streaming) ─────────────────────────────────

function parseNativeResponse(response) {
  let text = ''
  let toolInput = null
  for (const block of response.content ?? []) {
    if (block.type === 'text') text += block.text
    if (block.type === 'tool_use' && block.name === 'schedule_task') {
      toolInput = { ...block.input, id: `task-${Date.now()}` }
    }
  }
  return { text, toolInput }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatInterface({
  eventsForPrompt,
  todayFreeWindows,
  isCalendarConnected,
  onTaskAdded,
  onEventsRefresh,
}) {
  const greeting = isCalendarConnected
    ? "I can see your calendar. Tell me what you need to get done and I'll find the perfect slot."
    : "Connect Google Calendar above for smarter scheduling. Or just tell me what you need — I'll suggest times based on best practices."

  const [messages, setMessages] = useState([{
    id: 'welcome', role: 'assistant', content:
      `Hi! I'm **Donna**, your AI scheduling assistant. ${greeting}\n\nWhat's on your plate today?`,
  }])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const { isListening, isSupported, startListening, stopListening } =
    useSpeechRecognition({
      onResult: (t) => setInput((p) => (p ? `${p} ${t}` : t)),
    })

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const aId = `a-${Date.now() + 1}`

    setMessages((p) => [...p, userMsg, { id: aId, role: 'assistant', content: '' }])
    setInput('')
    setIsStreaming(true)

    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
    const systemPrompt = buildSystemPrompt(eventsForPrompt, todayFreeWindows)

    try {
      if (isNative) {
        // ── Native: single blocking request ────────────────────────────────
        const response = await nativeChatCompletion(history, systemPrompt)
        const { text: responseText, toolInput } = parseNativeResponse(response)

        setMessages((p) => p.map((m) =>
          m.id === aId ? { ...m, content: responseText, taskSuggestion: toolInput, status: toolInput ? 'pending' : undefined } : m
        ))
        if (toolInput) onTaskAdded({ ...toolInput, status: 'pending' })

      } else {
        // ── Web: streaming ─────────────────────────────────────────────────
        let fullText = ''
        let toolInput = null

        for await (const chunk of streamChatCompletion(history, systemPrompt)) {
          if (chunk.type === 'text') {
            fullText += chunk.text
            setMessages((p) => p.map((m) => m.id === aId ? { ...m, content: fullText } : m))
          }
          if (chunk.type === 'tool_use' && chunk.name === 'schedule_task') {
            toolInput = { ...chunk.input, id: `task-${Date.now()}` }
          }
        }

        setMessages((p) => p.map((m) =>
          m.id === aId ? { ...m, taskSuggestion: toolInput, status: toolInput ? 'pending' : undefined } : m
        ))
        if (toolInput) onTaskAdded({ ...toolInput, status: 'pending' })
      }
    } catch (err) {
      setMessages((p) => p.map((m) =>
        m.id === aId ? { ...m, content: `Sorry, something went wrong: ${err.message}` } : m
      ))
    } finally {
      setIsStreaming(false)
    }
  }, [messages, isStreaming, eventsForPrompt, todayFreeWindows, onTaskAdded])

  // ── Confirm scheduling ────────────────────────────────────────────────────

  const handleScheduleTask = useCallback(async (task) => {
    if (!isCalendarConnected) { alert('Please connect Google Calendar first.'); return }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    // Map category to Google Calendar color ID
    const COLOR_MAP = { work: '9', personal: '7', health: '2', learning: '5', finance: '6', social: '3', other: '8' }
    const colorId = COLOR_MAP[task.category] ??
      (task.priority === 'high' ? '11' : task.priority === 'medium' ? '6' : '7')

    const eventBody = {
      summary: task.title,
      description: [
        task.description ?? '',
        task.reasoning ? `\n\n[Scheduled by Donna]\nReasoning: ${task.reasoning}` : '',
      ].join('').trim(),
      ...(task.location ? { location: task.location } : {}),
      start: { dateTime: task.suggested_start, timeZone: tz },
      end:   { dateTime: task.suggested_end,   timeZone: tz },
      colorId,
    }

    try {
      await createEvent(eventBody)

      setMessages((p) => p.map((m) =>
        m.taskSuggestion?.id === task.id ? { ...m, status: 'scheduled' } : m
      ))
      onTaskAdded({ ...task, status: 'scheduled' })
      if (onEventsRefresh) await onEventsRefresh()

      const when = new Date(task.suggested_start).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
      setMessages((p) => [...p, {
        id: `c-${Date.now()}`, role: 'assistant',
        content: `Done! **"${task.title}"** is on your calendar for ${when}. What else can I schedule for you?`,
      }])
    } catch (err) {
      alert(`Failed to add event: ${err.message}`)
    }
  }, [isCalendarConnected, onTaskAdded, onEventsRefresh])

  const handleSubmit = (e) => { e.preventDefault(); sendMessage(input) }
  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }

  return (
    <div className="chat-interface">
      <div className="messages">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} onScheduleTask={handleScheduleTask} />
        ))}
        {isStreaming && (
          <div className="message assistant">
            <div className="msg-avatar">D</div>
            <div className="typing-dots"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <VoiceButton
          isListening={isListening} isSupported={isSupported}
          onStart={startListening} onStop={stopListening}
        />
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={isListening ? 'Listening…' : 'Tell Donna what to schedule…'}
          rows={1}
          disabled={isStreaming}
        />
        <button type="submit" className="send-btn" disabled={!input.trim() || isStreaming} aria-label="Send">
          {isStreaming ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  )
}
