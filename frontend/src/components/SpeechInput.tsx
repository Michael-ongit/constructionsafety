import React, { useCallback, useRef } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { cn } from '../lib/utils'

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement
  const nativeSetter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  if (nativeSetter) {
    nativeSetter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

// ---------------------------------------------------------------------------
// SpeechInput
// ---------------------------------------------------------------------------
interface SpeechInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: string
}

export function SpeechInput({ className, onChange, value, ...props }: SpeechInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { isSupported, isListening, isProcessing, error, start, stop } = useSpeechRecognition()

  const handleMicClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isListening) {
      stop()
      return
    }
    start((text: string) => {
      const el = inputRef.current
      if (!el) return
      const currentVal = el.value
      const newVal = currentVal ? currentVal + ' ' + text : text
      setNativeValue(el, newVal)
      if (onChangeRef.current) {
        onChangeRef.current({
          target: el,
          currentTarget: el,
          type: 'change',
          bubbles: true,
          cancelable: false,
        } as React.ChangeEvent<HTMLInputElement>)
      }
    })
  }, [isListening, start, stop])

  const micButton = (
    <button
      type="button"
      onClick={handleMicClick}
      disabled={!isSupported}
      aria-label={isListening ? 'Stop recording' : 'Start voice input'}
      title={error || (isListening ? 'Listening...' : 'Voice input')}
      className={cn(
        'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
        isListening
          ? 'bg-blue-600 text-white shadow-[0_0_12px_2px_rgba(37,99,235,0.6)] animate-pulse hover:bg-blue-700'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
        !isSupported && 'hidden',
      )}
    >
      {isProcessing ? (
        <Loader2 size={16} className="animate-spin text-white" />
      ) : isListening ? (
        <MicOff size={16} className="text-white" />
      ) : (
        <Mic size={16} />
      )}
    </button>
  )

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        className={cn(className, isSupported && 'pr-9')}
        {...props}
      />
      {micButton}
      {error && (
        <p className="absolute -bottom-4 left-0 text-[10px] text-rose-500 truncate w-full pointer-events-none">{error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SpeechTextarea
// ---------------------------------------------------------------------------
export function SpeechTextarea({
  className,
  onChange,
  value,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { isSupported, isListening, isProcessing, error, start, stop } = useSpeechRecognition()

  const handleMicClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isListening) {
      stop()
      return
    }
    start((text: string) => {
      const el = textareaRef.current
      if (!el) return
      const currentVal = el.value
      const separator = currentVal ? '\n' : ''
      const newVal = currentVal + separator + text
      setNativeValue(el, newVal)
      if (onChangeRef.current) {
        onChangeRef.current({
          target: el,
          currentTarget: el,
          type: 'change',
          bubbles: true,
          cancelable: false,
        } as React.ChangeEvent<HTMLTextAreaElement>)
      }
    })
  }, [isListening, start, stop])

  const micButton = (
    <button
      type="button"
      onClick={handleMicClick}
      disabled={!isSupported}
      aria-label={isListening ? 'Stop recording' : 'Start voice input'}
      title={error || (isListening ? 'Listening...' : 'Voice input')}
      className={cn(
        'absolute right-2 bottom-2 p-1.5 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
        isListening
          ? 'bg-blue-600 text-white shadow-[0_0_12px_2px_rgba(37,99,235,0.6)] animate-pulse hover:bg-blue-700'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
        !isSupported && 'hidden',
      )}
    >
      {isProcessing ? (
        <Loader2 size={16} className="animate-spin text-white" />
      ) : isListening ? (
        <MicOff size={16} className="text-white" />
      ) : (
        <Mic size={16} />
      )}
    </button>
  )

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        className={cn(className, isSupported && 'pr-9')}
        {...props}
      />
      {micButton}
      {error && (
        <p className="absolute -bottom-4 left-0 text-[10px] text-rose-500 truncate w-full pointer-events-none">{error}</p>
      )}
    </div>
  )
}
