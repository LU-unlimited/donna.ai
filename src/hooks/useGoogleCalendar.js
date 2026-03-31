import { useState, useEffect, useCallback } from 'react'
import {
  setClientId,
  requestAccessToken,
  listEvents,
  formatEventsForPrompt,
} from '../services/googleCalendar'

/**
 * Manages the Google Calendar OAuth connection and event data.
 */
export function useGoogleCalendar() {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [isGISReady, setIsGISReady] = useState(false)

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  // Poll until the GIS script injected by index.html is ready
  useEffect(() => {
    let timer
    const check = () => {
      if (typeof google !== 'undefined' && google.accounts) {
        setIsGISReady(true)
        if (clientId) setClientId(clientId)
      } else {
        timer = setTimeout(check, 150)
      }
    }
    check()
    return () => clearTimeout(timer)
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
      setError('VITE_GOOGLE_CLIENT_ID is not set. Add it to your .env file.')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await requestAccessToken()
      setIsConnected(true)
      await refreshEvents()
    } catch (err) {
      setError(err.message || 'Google Calendar connection failed')
    } finally {
      setIsLoading(false)
    }
  }, [clientId, refreshEvents])

  return {
    isConnected,
    isLoading,
    isGISReady,
    events,
    eventsForPrompt: formatEventsForPrompt(events),
    error,
    connect,
    refreshEvents,
  }
}
