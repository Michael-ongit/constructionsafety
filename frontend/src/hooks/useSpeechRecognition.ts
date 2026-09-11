import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Module-level singleton state — ensures only one recording session at a time
// ---------------------------------------------------------------------------
type SessionCallback = (text: string) => void

interface Session {
  stop: () => void
  onResult: SessionCallback
  source: 'browser' | 'backend'
}

let currentSession: Session | null = null
let sessionListeners = new Set<() => void>()

function notifySessions(): void {
  sessionListeners.forEach(fn => fn())
}

type State = 'idle' | 'listening' | 'processing' | 'error'

interface GlobalState {
  state: State
  error: string | null
  interimText: string
}

let globalState: GlobalState = {
  state: 'idle',
  error: null,
  interimText: '',
}

function setGlobalState(partial: Partial<GlobalState>): void {
  globalState = { ...globalState, ...partial }
  notifySessions()
}

// ---------------------------------------------------------------------------
// Browser SpeechRecognition
// ---------------------------------------------------------------------------
const SpeechRecognitionAPI =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

function startBrowserSR(onResult: SessionCallback): () => void {
  let recognition: any
  try {
    recognition = new SpeechRecognitionAPI()
  } catch (e: any) {
    setGlobalState({ state: 'error', error: `Speech API unavailable: ${e.message}` })
    return () => {}
  }

  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-US'

  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let started = true
  let hasEnded = false

  // Text-based duplicate prevention:
  // Tracks the full transcript text that has been committed via onResult.
  // Each onresult event builds a full transcript from ALL final results at that moment,
  // then compares with committedText to extract only the delta.
  // This is resilient against Chrome's internal restart bug where the same word
  // appears at a new result index — the text comparison catches it as already-committed.
  let committedText = ''

  const clearSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  const resetSilenceTimer = () => {
    clearSilenceTimer()
    silenceTimer = setTimeout(() => {
      if (started) {
        started = false
        try { recognition.stop() } catch { /* ignore */ }
      }
    }, 2000)
  }

  recognition.onresult = (event: any) => {
    if (!started || hasEnded) return

    // Build the full current transcript from ALL final results
    let fullTranscript = ''
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i]
      if (result.isFinal) {
        const t = result[0].transcript.trim()
        if (t) fullTranscript += (fullTranscript ? ' ' : '') + t
      }
    }

    // Compute interim text for UI display
    let interim = ''
    for (let i = 0; i < event.results.length; i++) {
      if (!event.results[i].isFinal) {
        interim += (interim ? ' ' : '') + event.results[i][0].transcript
      }
    }
    setGlobalState({ interimText: interim, state: 'listening' })

    if (!fullTranscript) return

    // --- Duplicate prevention via text comparison ---
    // fullTranscript starts with committedText: new text was appended normally.
    //   Example: committed="Hello", full="Hello world" → delta="world" ✓
    // fullTranscript is shorter/non-matching: API refined or restarted.
    //   Only accept if fullTranscript genuinely differs from committed
    //   and doesn't just repeat committed words at new indices.
    if (fullTranscript.startsWith(committedText)) {
      if (fullTranscript.length > committedText.length) {
        const delta = fullTranscript.slice(committedText.length).trim()
        if (delta) {
          committedText = fullTranscript
          onResult(delta)
          resetSilenceTimer()
        }
      }
    } else if (fullTranscript.length > committedText.length) {
      // Non-progressive change — extract only the genuinely new portion
      // by finding words that aren't repeats of already-committed words.
      const committedWords = committedText ? committedText.split(/\s+/) : []
      const fullWords = fullTranscript.split(/\s+/)
      const skipCount = Math.min(committedWords.length, fullWords.length)

      // Find where the new words start
      let idx = 0
      while (idx < skipCount && fullWords[idx] === committedWords[idx]) idx++

      const newWords = fullWords.slice(idx).join(' ')
      if (newWords && newWords !== committedText) {
        committedText = fullTranscript
        onResult(newWords)
        resetSilenceTimer()
      } else {
        committedText = fullTranscript
      }
    }
    // If fullTranscript.length <= committedText.length, it's a refinement
    // (e.g., capitalization change). Silently update committedText without
    // firing onResult to avoid re-sending already-appended words.
    else if (fullTranscript !== committedText) {
      committedText = fullTranscript
    }
  }

  recognition.onerror = (event: any) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return
    const msg = event.error === 'not-allowed'
      ? 'Microphone access blocked. Check browser permissions or use HTTPS.'
      : `Speech error: ${event.error}`
    setGlobalState({ state: 'error', error: msg })
    started = false
    hasEnded = true
  }

  recognition.onend = () => {
    clearSilenceTimer()
    setGlobalState({ state: 'idle', interimText: '', error: null })
    started = false
    hasEnded = true
  }

  try {
    recognition.start()
    setGlobalState({ state: 'listening', error: null, interimText: '' })
  } catch (e: any) {
    setGlobalState({ state: 'error', error: `Failed to start: ${e.message}` })
    started = false
    hasEnded = true
  }

  return () => {
    started = false
    hasEnded = true
    clearSilenceTimer()
    try { recognition.stop() } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// MediaRecorder fallback → backend /api/speech-to-text
// ---------------------------------------------------------------------------
function startBackendSR(onResult: SessionCallback): () => void {
  let mediaRecorder: MediaRecorder | null = null
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let started = true
  let hasSpoken = false

  const SILENCE_THRESHOLD = 15
  const SILENCE_DURATION = 2000
  const CHECK_INTERVAL = 200

  const clearSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  const cleanup = () => {
    started = false
    clearSilenceTimer()
    if (source) { try { source.disconnect() } catch { /* ignore */ } }
    if (audioContext) { try { audioContext.close() } catch { /* ignore */ } }
    if (stream) { stream.getTracks().forEach(t => t.stop()) }
    mediaRecorder = null
    audioContext = null
    source = null
    stream = null
    chunks = []
    setGlobalState({ state: 'idle', interimText: '', error: null })
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(async (mediaStream) => {
      if (!started) { mediaStream.getTracks().forEach(t => t.stop()); return }
      stream = mediaStream
      audioContext = new AudioContext()
      source = audioContext.createMediaStreamSource(mediaStream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/ogg;codecs=opus'

      mediaRecorder = new MediaRecorder(mediaStream, { mimeType })

      mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        if (!started) { cleanup(); return }
        setGlobalState({ state: 'processing', interimText: '' })
        const blob = new Blob(chunks, { type: mimeType })
        try {
          const formData = new FormData()
          formData.append('audio', blob, 'recording.' + (mimeType.includes('ogg') ? 'ogg' : 'webm'))
          const res = await fetch('/api/speech-to-text', { method: 'POST', body: formData })
          if (!res.ok) throw new Error(`Backend returned ${res.status}`)
          const data = await res.json()
          if (data.text?.trim()) {
            onResult(data.text.trim())
          }
        } catch (e: any) {
          setGlobalState({ state: 'error', error: `Transcription failed: ${e.message}` })
        }
        cleanup()
      }

      mediaRecorder.start()
      setGlobalState({ state: 'listening', error: null, interimText: '' })

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const checkVolume = () => {
        if (!started || !analyser) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        if (avg > SILENCE_THRESHOLD) {
          hasSpoken = true
          clearSilenceTimer()
        } else if (hasSpoken) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              if (started && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop()
              }
            }, SILENCE_DURATION)
          }
        }
        if (started) setTimeout(checkVolume, CHECK_INTERVAL)
      }
      checkVolume()
    })
    .catch((e: any) => {
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setGlobalState({ state: 'error', error: 'Microphone permission denied' })
      } else if (e.name === 'NotFoundError') {
        setGlobalState({ state: 'error', error: 'No microphone found' })
      } else {
        setGlobalState({ state: 'error', error: `Microphone error: ${e.message}` })
      }
    })

  return () => {
    started = false
    clearSilenceTimer()
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop()
    } else {
      cleanup()
    }
  }
}

// ---------------------------------------------------------------------------
// getUserMedia with legacy API fallback
// ---------------------------------------------------------------------------
function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const gum = navigator.mediaDevices?.getUserMedia
  if (gum) return gum.call(navigator.mediaDevices, constraints)
  const legacy = (navigator as any).webkitGetUserMedia || (navigator as any).mozGetUserMedia || (navigator as any).msGetUserMedia
  if (legacy) {
    return new Promise((resolve, reject) => {
      legacy.call(navigator, constraints, resolve, reject)
    })
  }
  return Promise.reject(new DOMException('getUserMedia not available', 'NotSupportedError'))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function useSpeechRecognition() {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    sessionListeners.add(fn)
    return () => { sessionListeners.delete(fn) }
  }, [])

  const isSupported = true

  const start = useCallback((onResult: SessionCallback) => {
    if (currentSession) {
      currentSession.stop()
      currentSession = null
    }

    const onHTTP = location.protocol !== 'https:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'

    if (SpeechRecognitionAPI && !onHTTP) {
      const stopFn = startBrowserSR(onResult)
      currentSession = { stop: stopFn, onResult, source: 'browser' }
      return
    }

    getUserMedia({ audio: true })
      .then(() => {
        const stopFn = startBackendSR(onResult)
        currentSession = { stop: stopFn, onResult, source: 'backend' }
      })
      .catch((e: any) => {
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          setGlobalState({ state: 'error', error: 'Microphone permission denied' })
        } else if (e.name === 'NotFoundError') {
          setGlobalState({ state: 'error', error: 'No microphone found' })
        } else if (e.name === 'NotSupportedError') {
          setGlobalState({ state: 'error', error: 'Speech not supported in this browser' })
        } else {
          setGlobalState({ state: 'error', error: `Microphone error: ${e.message}` })
        }
      })
  }, [])

  const stop = useCallback(() => {
    if (currentSession) {
      currentSession.stop()
      currentSession = null
    }
  }, [])

  return {
    isSupported,
    isListening: globalState.state === 'listening',
    isProcessing: globalState.state === 'processing',
    error: globalState.error,
    interimText: globalState.interimText,
    state: globalState.state,
    start,
    stop,
  }
}
