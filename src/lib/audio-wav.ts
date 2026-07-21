// Browser-side audio → 16 kHz mono WAV (PCM16) for the AI voice quick add.
//
// Why transcode at all: MediaRecorder produces audio/webm (Chrome/Android
// WebView) or audio/mp4 (iOS WKWebView), and Gemini's inline audio accepts
// NEITHER — only wav/mp3/aiff/aac/ogg-vorbis/flac (ai.google.dev/gemini-api/
// docs/audio). Every engine can, however, DECODE its own recording via Web
// Audio, so we decode → downmix to mono → resample to 16 kHz → WAV-encode.
// Speech models are trained on 16 kHz; 60 s comes to ~1.9 MB (~2.56 MB b64).

export const WAV_SAMPLE_RATE = 16000

/** Encode Float32 PCM samples (already mono @ sampleRate) into a WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return buffer
}

/** ArrayBuffer → base64 without blowing the call stack on large buffers. */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Decode a recorded blob (webm/mp4/ogg) and re-encode as mono WAV base64. */
export async function blobToWavBase64(blob: Blob, sampleRate: number = WAV_SAMPLE_RATE): Promise<string> {
  const encoded = await blob.arrayBuffer()
  // Decode at native rate first (decodeAudioData ignores the context rate for
  // compressed sources in some engines), then resample via OfflineAudioContext.
  const probe = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await probe.decodeAudioData(encoded)
  } finally {
    void probe.close()
  }
  const length = Math.ceil((decoded.duration || 0) * sampleRate)
  if (length === 0) throw new Error("empty recording")
  const offline = new OfflineAudioContext(1, length, sampleRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return bufferToBase64(encodeWav(rendered.getChannelData(0), sampleRate))
}

export type PcmTap = {
  /** Mono WAV base64 of everything captured so far (resampled to targetRate), or null when nothing was captured yet. */
  getWavBase64: (targetRate: number) => Promise<string | null>
  close: () => void
}

/**
 * Taps raw PCM off a live mic graph so a WAV of the audio-so-far can be
 * encoded at ANY moment — the basis of server-side live transcription in the
 * native WebViews (no SpeechRecognition there). Raw samples are the only
 * mid-recording source that always works: decoding a TRUNCATED MediaRecorder
 * container is an engine lottery (WKWebView's fMP4 in particular).
 * ScriptProcessorNode is deprecated but universally shipped, and an
 * AudioWorklet would need a served module file for a plain copy tap.
 * Capture stops silently at `maxSeconds` (memory/upload budget); the real
 * recording is not affected. Call close() when the meter graph is torn down.
 */
export function createPcmTap(ctx: AudioContext, source: AudioNode, maxSeconds: number): PcmTap {
  const rate = ctx.sampleRate
  const maxSamples = maxSeconds * rate
  const chunks: Float32Array[] = []
  let total = 0
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = (e) => {
    if (total >= maxSamples) return
    const input = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    total += input.length
  }
  source.connect(proc)
  // A muted sink keeps the processor pulled without routing mic → speakers.
  const sink = ctx.createGain()
  sink.gain.value = 0
  proc.connect(sink)
  sink.connect(ctx.destination)

  return {
    async getWavBase64(targetRate: number): Promise<string | null> {
      if (total === 0) return null
      const snapshotTotal = total // capture length before any concurrent push
      const merged = new Float32Array(snapshotTotal)
      let offset = 0
      for (const c of chunks) {
        if (offset + c.length > snapshotTotal) break
        merged.set(c, offset)
        offset += c.length
      }
      // createBuffer over `new AudioBuffer({...})`: same object, but the
      // factory has existed since the first Web Audio shipped — no WebView
      // vintage can miss it.
      const source = ctx.createBuffer(1, snapshotTotal, rate)
      source.copyToChannel(merged, 0)
      const length = Math.ceil((snapshotTotal / rate) * targetRate)
      const offline = new OfflineAudioContext(1, length, targetRate)
      const src = offline.createBufferSource()
      src.buffer = source
      src.connect(offline.destination)
      src.start()
      const rendered = await offline.startRendering()
      return bufferToBase64(encodeWav(rendered.getChannelData(0), targetRate))
    },
    close() {
      proc.onaudioprocess = null
      try { proc.disconnect(); sink.disconnect() } catch { /* graph already torn down */ }
      chunks.length = 0
      total = maxSamples // stop any in-flight push
    },
  }
}
