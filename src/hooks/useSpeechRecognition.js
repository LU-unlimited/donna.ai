import { useState, useRef, useCallback } from 'react'

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

/**
 * Thin wrapper around the Web Speech API.
 *
 * @param {object} opts
 * @param {(transcript: string) => void} opts.onResult  - called with the final transcript
 * @param {(error: string) => void}      opts.onError   - called on recognition error
 */
export function useSpeechRecognition({ onResult, onError } = {}) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)
  const isSupported = Boolean(SpeechRecognition)

  const startListening = useCallback(() => {
    if (!isSupported) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => setIsListening(false)

    recognition.onerror = (e) => {
      setIsListening(false)
      if (onError) onError(e.error)
    }

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      if (onResult) onResult(transcript)
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [isSupported, onResult, onError])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  return { isListening, isSupported, startListening, stopListening }
}
