import { Capacitor, CapacitorHttp } from '@capacitor/core'

const MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
const ANTHROPIC_API = 'https://api.anthropic.com'
const WEB_PROXY = '/api/anthropic'

function getApiKey() {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) throw new Error('VITE_ANTHROPIC_API_KEY not set — create a .env file (see .env.example)')
  return key
}

// ---------------------------------------------------------------------------
// Tool definitions — Claude uses these to produce structured scheduling output
// ---------------------------------------------------------------------------
export const SCHEDULING_TOOLS = [
  {
    name: 'schedule_task',
    description: `Schedule a task on the user's calendar. Call this when you have determined
the optimal time slot and have all details needed to create the calendar event.
Analyze the existing calendar events to avoid conflicts and find the best free window.`,
    input_schema: {
      type: 'object',
      required: ['title', 'duration_minutes', 'priority', 'suggested_start', 'suggested_end', 'reasoning'],
      properties: {
        title: { type: 'string', description: 'Clear, action-oriented event title' },
        description: { type: 'string', description: 'Detailed description of what to accomplish, goals, and context' },
        location: { type: 'string', description: 'Physical address, room name, "Virtual/Online", or omit' },
        duration_minutes: { type: 'integer', description: 'Realistic duration estimate in minutes' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task urgency/importance' },
        suggested_start: { type: 'string', description: 'ISO 8601 start time (e.g. 2025-04-01T14:00:00)' },
        suggested_end: { type: 'string', description: 'ISO 8601 end time' },
        category: {
          type: 'string',
          enum: ['work', 'personal', 'health', 'learning', 'social', 'finance', 'other'],
          description: 'Task category for color coding',
        },
        energy_level: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Mental energy required — schedule high-energy tasks in the morning',
        },
        preferred_time_of_day: {
          type: 'string',
          enum: ['morning', 'afternoon', 'evening', 'any'],
          description: 'Best time of day for this task type',
        },
        reasoning: {
          type: 'string',
          description: 'Explain why this time slot was chosen over alternatives',
        },
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Streaming chat (web only — uses Vite proxy to bypass CORS)
// ---------------------------------------------------------------------------
export async function* streamChatCompletion(messages, systemPrompt) {
  const apiKey = getApiKey()

  const response = await fetch(`${WEB_PROXY}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      stream: true,
      tools: SCHEDULING_TOOLS,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic error ${response.status}: ${err}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let toolCallBuffer = null // accumulates tool_use content block

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const ev = JSON.parse(data)

        // Text delta — stream to UI
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          yield { type: 'text', text: ev.delta.text }
        }

        // Tool use starts
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          toolCallBuffer = { name: ev.content_block.name, inputJson: '' }
        }

        // Tool input JSON accumulates
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
          if (toolCallBuffer) toolCallBuffer.inputJson += ev.delta.partial_json
        }

        // Tool use block complete
        if (ev.type === 'content_block_stop' && toolCallBuffer) {
          try {
            const input = JSON.parse(toolCallBuffer.inputJson)
            yield { type: 'tool_use', name: toolCallBuffer.name, input }
          } catch {
            // malformed tool JSON — skip
          }
          toolCallBuffer = null
        }
      } catch {
        // skip malformed SSE chunk
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Non-streaming request (native Android — uses CapacitorHttp to bypass WebView CORS)
// ---------------------------------------------------------------------------
export async function nativeChatCompletion(messages, systemPrompt) {
  const apiKey = getApiKey()

  const result = await CapacitorHttp.request({
    method: 'POST',
    url: `${ANTHROPIC_API}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    data: {
      model: MODEL,
      max_tokens: 4096,
      stream: false,
      tools: SCHEDULING_TOOLS,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    },
  })

  if (result.status !== 200) {
    throw new Error(`Anthropic error ${result.status}: ${JSON.stringify(result.data)}`)
  }

  return result.data
}

// ---------------------------------------------------------------------------
// Unified entry — auto-selects method based on platform
// ---------------------------------------------------------------------------
export const isNative = Capacitor.isNativePlatform()
