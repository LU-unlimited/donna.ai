import { Mic, MicOff } from 'lucide-react'

export function VoiceButton({ isListening, isSupported, onStart, onStop }) {
  if (!isSupported) return null

  return (
    <button
      type="button"
      className={`voice-btn${isListening ? ' listening' : ''}`}
      onClick={isListening ? onStop : onStart}
      title={isListening ? 'Stop listening' : 'Voice input'}
      aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
    >
      {isListening ? <MicOff size={18} /> : <Mic size={18} />}
      {isListening && <span className="pulse-ring" aria-hidden="true" />}
    </button>
  )
}
