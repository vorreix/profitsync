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

/** Decode a recorded blob (webm/mp4/ogg) and re-encode as 16 kHz mono WAV base64. */
export async function blobToWavBase64(blob: Blob): Promise<string> {
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
  const length = Math.ceil((decoded.duration || 0) * WAV_SAMPLE_RATE)
  if (length === 0) throw new Error("empty recording")
  const offline = new OfflineAudioContext(1, length, WAV_SAMPLE_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const wav = encodeWav(rendered.getChannelData(0), WAV_SAMPLE_RATE)

  // ArrayBuffer → base64 without blowing the call stack on large buffers.
  const bytes = new Uint8Array(wav)
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
