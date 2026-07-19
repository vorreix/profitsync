import { useCallback, useEffect, useRef, useState } from "react"
import { blobToWavBase64 } from "@/lib/audio-wav"

export type RecorderState = "idle" | "recording" | "processing"

/**
 * Microphone recorder for the AI voice quick add. Records via MediaRecorder
 * (whatever container the engine supports), auto-stops at `maxSeconds`, and
 * hands back a 16 kHz mono WAV base64 (the only universally Gemini-accepted
 * format we can produce client-side — see src/lib/audio-wav.ts).
 */
export function useVoiceRecorder({ maxSeconds, sampleRate, onFinish, onError, onStream }: {
  maxSeconds: number
  // WAV resample rate; the assistant uses 12000 to fit long premium
  // recordings under the request-body limit (default 16000).
  sampleRate?: number
  onFinish: (wavBase64: string) => void
  onError: (kind: "denied" | "failed") => void
  // Fired when the mic stream opens — used to attach an AnalyserNode for
  // live waveform rendering. The stream is owned by the hook; do not stop it.
  onStream?: (stream: MediaStream) => void
}) {
  const [state, setState] = useState<RecorderState>("idle")
  const [elapsed, setElapsed] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)
  const startedAtRef = useRef(0)

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recRef.current = null
    chunksRef.current = []
  }, [])

  // Unmount safety: never leave the mic open.
  useEffect(() => () => { cancelledRef.current = true; try { recRef.current?.stop() } catch { /* already stopped */ } cleanup() }, [cleanup])

  const start = useCallback(async () => {
    if (state !== "idle") return
    cancelledRef.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError("denied")
      return
    }
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
        .find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t))
      const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined)
      streamRef.current = stream
      recRef.current = rec
      chunksRef.current = []
      onStream?.(stream)
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onerror = () => { cleanup(); setState("idle"); onError("failed") }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" })
        const wasCancelled = cancelledRef.current
        cleanup()
        if (wasCancelled) { setState("idle"); return }
        setState("processing")
        try {
          const wav = await blobToWavBase64(blob, sampleRate)
          setState("idle")
          onFinish(wav)
        } catch {
          setState("idle")
          onError("failed")
        }
      }
      startedAtRef.current = Date.now()
      setElapsed(0)
      rec.start(1000)
      setState("recording")
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - startedAtRef.current) / 1000
        setElapsed(Math.min(secs, maxSeconds))
        // Auto-stop at the plan's ceiling; the recording so far is still used.
        if (secs >= maxSeconds && recRef.current?.state === "recording") recRef.current.stop()
      }, 200)
    } catch {
      cleanup()
      onError("failed")
    }
  }, [state, maxSeconds, sampleRate, onFinish, onError, onStream, cleanup])

  const stop = useCallback(() => {
    if (recRef.current?.state === "recording") recRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (recRef.current?.state === "recording") recRef.current.stop()
    else { cleanup(); setState("idle") }
  }, [cleanup])

  return { state, elapsed, start, stop, cancel }
}
