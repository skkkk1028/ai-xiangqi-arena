let audioContext: AudioContext | null = null

/** Optional Web Audio cues; all failures are intentionally swallowed. */
export function playChessMoveSound(kind: 'move' | 'capture' | 'check'): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    audioContext ??= new AudioContextCtor()
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined)
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const now = audioContext.currentTime
    oscillator.type = kind === 'check' ? 'triangle' : 'sine'
    oscillator.frequency.value = kind === 'check' ? 520 : kind === 'capture' ? 250 : 340
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'check' ? 0.18 : 0.11))
    oscillator.connect(gain).connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + (kind === 'check' ? 0.2 : 0.12))
  } catch {
    // Browser autoplay and audio device policies must never affect chess state.
  }
}
