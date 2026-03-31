const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const SCOPES = 'https://www.googleapis.com/auth/calendar'

let _clientId = null
let _tokenClient = null
let _accessToken = null
let _tokenExpiry = 0

function ensureTokenClient() {
  if (_tokenClient) return
  if (typeof google === 'undefined' || !google.accounts) {
    throw new Error('Google Identity Services not loaded yet')
  }
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: _clientId,
    scope: SCOPES,
    callback: () => {}, // overridden per request
  })
}

/**
 * Sets the client ID and wires up the token client.
 * Call once on app init.
 */
export function setClientId(clientId) {
  _clientId = clientId
}

/**
 * Opens the Google OAuth popup and resolves with the access token.
 * On subsequent calls, tries a silent refresh first.
 */
export function requestAccessToken() {
  return new Promise((resolve, reject) => {
    ensureTokenClient()

    _tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error))
        return
      }
      _accessToken = response.access_token
      // Expire 60s early to avoid using an about-to-expire token
      _tokenExpiry = Date.now() + (response.expires_in - 60) * 1000
      resolve(_accessToken)
    }

    // Skip consent prompt if we already have a token (silent refresh attempt)
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'consent' })
  })
}

async function getValidToken() {
  if (_accessToken && Date.now() < _tokenExpiry) {
    return _accessToken
  }
  return requestAccessToken()
}

async function authFetch(url, options = {}) {
  const token = await getValidToken()
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return res
}

/** Fetch events for the next `daysAhead` days from the primary calendar. */
export async function listEvents(daysAhead = 14) {
  const now = new Date()
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  })

  const res = await authFetch(`${CALENDAR_API}/calendars/primary/events?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Calendar list error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return data.items ?? []
}

/** Create a new event on the primary calendar. */
export async function createEvent(eventBody) {
  const res = await authFetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    body: JSON.stringify(eventBody),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Calendar create error ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Formats calendar events into a compact, AI-readable string grouped by day.
 * Example:
 *   Mon, Apr 1:
 *     09:00–10:00  Team standup
 *     14:00–15:30  Client review
 */
export function formatEventsForPrompt(events) {
  if (!events || events.length === 0) {
    return 'No upcoming events in the next 14 days.'
  }

  const grouped = {}
  for (const event of events) {
    const rawStart = event.start?.dateTime ?? event.start?.date
    if (!rawStart) continue
    const date = new Date(rawStart)
    const dayKey = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    if (!grouped[dayKey]) grouped[dayKey] = []
    grouped[dayKey].push(event)
  }

  return Object.entries(grouped)
    .map(([day, dayEvents]) => {
      const lines = dayEvents.map((ev) => {
        const start = ev.start?.dateTime
        const end = ev.end?.dateTime
        if (start && end) {
          const s = new Date(start).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
          const e = new Date(end).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
          return `  ${s}–${e}  ${ev.summary ?? 'Busy'}`
        }
        return `  All day  ${ev.summary ?? 'Busy'}`
      })
      return `${day}:\n${lines.join('\n')}`
    })
    .join('\n\n')
}
