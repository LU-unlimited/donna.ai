import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App } from '@capacitor/app'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const SCOPES = 'https://www.googleapis.com/auth/calendar'
// OAuth redirect URI — must be registered in Google Cloud Console
// For web:    http://localhost:5173  (no redirect URI needed for GIS implicit)
// For Android: donna://oauth2redirect  (register as custom scheme)
const ANDROID_REDIRECT_URI = 'donna://oauth2redirect'

let _clientId = null
let _tokenClient = null  // GIS token client (web only)
let _accessToken = null
let _tokenExpiry = 0

export function setClientId(id) {
  _clientId = id
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isTokenValid() {
  return _accessToken && Date.now() < _tokenExpiry
}

function storeToken(token, expiresIn) {
  _accessToken = token
  _tokenExpiry = Date.now() + (expiresIn - 60) * 1000
  // Persist so it survives page refreshes in the WebView
  try {
    sessionStorage.setItem('donna_gcal_token', token)
    sessionStorage.setItem('donna_gcal_expiry', String(_tokenExpiry))
  } catch { /* ignore */ }
}

function loadStoredToken() {
  try {
    const token = sessionStorage.getItem('donna_gcal_token')
    const expiry = Number(sessionStorage.getItem('donna_gcal_expiry') ?? 0)
    if (token && Date.now() < expiry) {
      _accessToken = token
      _tokenExpiry = expiry
      return true
    }
  } catch { /* ignore */ }
  return false
}

// ── Web OAuth via Google Identity Services ────────────────────────────────────

function ensureGISClient() {
  if (_tokenClient) return
  if (typeof google === 'undefined' || !google?.accounts?.oauth2) {
    throw new Error('Google Identity Services script not loaded')
  }
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: _clientId,
    scope: SCOPES,
    callback: () => {},
  })
}

function webRequestToken() {
  return new Promise((resolve, reject) => {
    ensureGISClient()
    _tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return }
      storeToken(resp.access_token, resp.expires_in)
      resolve(resp.access_token)
    }
    // Skip consent if we already connected before
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'consent' })
  })
}

// ── Android OAuth via Chrome Custom Tabs + deep link callback ─────────────────

function androidRequestToken() {
  return new Promise((resolve, reject) => {
    if (!_clientId) { reject(new Error('Google Client ID not set')); return }

    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: _clientId,
        redirect_uri: ANDROID_REDIRECT_URI,
        response_type: 'token',
        scope: SCOPES,
        include_granted_scopes: 'true',
      }).toString()

    // Listen for the app URL open event (deep link from Chrome back to app)
    const listener = App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith('donna://oauth2redirect')) return
      try {
        await Browser.close()
        // Token is in the fragment: donna://oauth2redirect#access_token=TOKEN&expires_in=3600
        const fragment = url.split('#')[1] ?? ''
        const params = new URLSearchParams(fragment)
        const token = params.get('access_token')
        const expiresIn = Number(params.get('expires_in') ?? 3600)
        if (token) {
          storeToken(token, expiresIn)
          ;(await listener).remove()
          resolve(token)
        } else {
          ;(await listener).remove()
          reject(new Error('No access_token in OAuth redirect'))
        }
      } catch (err) {
        reject(err)
      }
    })

    Browser.open({ url: authUrl })
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function requestAccessToken() {
  // Try reusing a valid stored token first
  if (loadStoredToken()) return _accessToken
  if (Capacitor.isNativePlatform()) {
    return androidRequestToken()
  }
  return webRequestToken()
}

async function getValidToken() {
  if (isTokenValid()) return _accessToken
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
  // Re-request on 401 (expired token not caught by our clock)
  if (res.status === 401) {
    _accessToken = null
    _tokenExpiry = 0
    sessionStorage.removeItem('donna_gcal_token')
    const newToken = await requestAccessToken()
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${newToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  }
  return res
}

/** Fetch events for the next `daysAhead` days. */
export async function listEvents(daysAhead = 14) {
  const now = new Date()
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '200',
  })
  const res = await authFetch(`${CALENDAR_API}/calendars/primary/events?${params}`)
  if (!res.ok) throw new Error(`Calendar list ${res.status}: ${await res.text()}`)
  return (await res.json()).items ?? []
}

/** Create an event on the primary calendar. */
export async function createEvent(body) {
  const res = await authFetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Calendar create ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Update an existing event. */
export async function updateEvent(eventId, body) {
  const res = await authFetch(
    `${CALENDAR_API}/calendars/primary/events/${eventId}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
  if (!res.ok) throw new Error(`Calendar update ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── Smart context formatting ─────────────────────────────────────────────────

/**
 * Formats events into a rich prompt section Claude can reason about.
 * Groups by day, shows free windows, and flags busy periods.
 */
export function formatEventsForPrompt(events) {
  if (!events?.length) return 'No upcoming events — calendar is wide open.'

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()

  // Group by day
  const grouped = {}
  for (const ev of events) {
    const raw = ev.start?.dateTime ?? ev.start?.date
    if (!raw) continue
    const d = new Date(raw)
    const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    if (!grouped[key]) grouped[key] = { events: [], date: d }
    grouped[key].events.push(ev)
  }

  const lines = []
  for (const [day, { events: dayEvs, date }] of Object.entries(grouped)) {
    const isToday = date.toDateString() === now.toDateString()
    lines.push(`\n**${day}${isToday ? ' (TODAY)' : ''}:**`)
    for (const ev of dayEvs) {
      const s = ev.start?.dateTime
      const e = ev.end?.dateTime
      if (s && e) {
        const start = new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        const end = new Date(e).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        lines.push(`  • ${start}–${end}  ${ev.summary ?? 'Busy'}`)
      } else {
        lines.push(`  • All day: ${ev.summary ?? 'Busy'}`)
      }
    }
  }

  // Compute and list free windows today
  const todayEvs = grouped[
    now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  ]?.events ?? []

  const freeWindows = findFreeWindows(todayEvs, now, 7) // 7 hours lookahead
  if (freeWindows.length) {
    lines.push('\n**Free windows today:**')
    for (const w of freeWindows) {
      lines.push(`  • ${w.start}–${w.end}  (${w.minutes}m free)`)
    }
  }

  lines.push(`\nTimezone: ${tz}`)
  return lines.join('\n')
}

/**
 * Find free windows in the next `hoursAhead` hours, ignoring outside 08:00–20:00.
 */
export function findFreeWindows(events, from, hoursAhead = 12, minSlotMinutes = 30) {
  const workStart = 8   // 08:00
  const workEnd   = 20  // 20:00

  const fromMs = from.getTime()
  const toMs   = fromMs + hoursAhead * 60 * 60 * 1000

  // Collect busy intervals (sorted, trimmed to work hours)
  const busy = events
    .map((ev) => {
      const s = ev.start?.dateTime ? new Date(ev.start.dateTime).getTime() : null
      const e = ev.end?.dateTime   ? new Date(ev.end.dateTime).getTime()   : null
      return s && e ? { s, e } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s)

  // Build free windows
  const windows = []
  let cursor = Math.max(fromMs, setHour(from, workStart))

  const dayEnd = setHour(from, workEnd)

  for (const { s, e } of busy) {
    if (s > cursor && cursor < Math.min(toMs, dayEnd)) {
      const end = Math.min(s, toMs, dayEnd)
      const mins = Math.round((end - cursor) / 60000)
      if (mins >= minSlotMinutes) {
        windows.push({
          start: fmtTime(cursor),
          end:   fmtTime(end),
          minutes: mins,
          startMs: cursor,
          endMs:   end,
        })
      }
    }
    cursor = Math.max(cursor, e)
  }

  // Tail window
  if (cursor < Math.min(toMs, dayEnd)) {
    const end = Math.min(toMs, dayEnd)
    const mins = Math.round((end - cursor) / 60000)
    if (mins >= minSlotMinutes) {
      windows.push({ start: fmtTime(cursor), end: fmtTime(end), minutes: mins, startMs: cursor, endMs: end })
    }
  }

  return windows
}

function setHour(date, hour) {
  const d = new Date(date)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}
