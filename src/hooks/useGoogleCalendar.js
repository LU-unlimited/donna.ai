import { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  setClientId,
  requestAccessToken,
  listEvents,
  formatEventsForPrompt,
  findFreeWindows,
} from '../services/googleCalendar'

const isNative = Capacitor.isNativePlatform()

export function useGoogleCalendar() {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [isGISReady, setIsGISReady] = useState(isNative) // native never needs GIS

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  // On web: poll for GIS script load
  useEffect(() => {
    if (isNative) return
    if (clientId) setClientId(clientId)

    let timer
    const check = () => {
      if (typeof google !== 'undefined' && google?.accounts?.oauth2) {
        setIsGISReady(true)
      } else {
        timer = setTimeout(check, 150)
      }
    }
    check()
    return () => clearTimeout(timer)
  }, [clientId])

  // On native: always set client ID
  useEffect(() => {
    if (isNative && clientId) setClientId(clientId)
  }, [clientId])

  const refreshEvents = useCallback(async () => {
    try {
      const items = await listEvents(14)
      setEvents(items)
      return items
    } catch (err) {
      setError(err.message)
      return []
    }
  }, [])

  const connect = useCallback(async () => {
    if (!clientId) {
      setError('VITE_GOOGLE_CLIENT_ID not set — add it to your .env file')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await requestAccessToken()
      setIsConnected(true)
      await refreshEvents()
    } catch (err) {
      // User cancelled popup — not an error to show
      if (err.message?.includes('popup_closed') || err.message?.includes('access_denied')) {
        setError('Calendar connection cancelled.')
      } else {
        setError(err.message || 'Google Calendar connection failed')
      }
    } finally {
      setIsLoading(false)
    }
  }, [clientId, refreshEvents])

  // Compute today's free windows for Claude context
  const todayFreeWindows = findFreeWindows(
    events.filter((ev) => {
      const raw = ev.start?.dateTime ?? ev.start?.date
      if (!raw) return false
      const d = new Date(raw)
      return d.toDateString() === new Date().toDateString()
    }),
    new Date(),
    12
  )

  return {
    isConnected,
    isLoading,
    isGISReady,
    isNative,
    events,
    eventsForPrompt: formatEventsForPrompt(events),
    todayFreeWindows,
    error,
    connect,
    refreshEvents,
  }
}
