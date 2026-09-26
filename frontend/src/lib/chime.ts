/**
 * A short two-note chime for the staff app (a client books while it is open), drawn with Web
 * Audio so no sound file ships. Browsers allow sound only after a tap: `listenForTaps()` unlocks
 * it on the first tap or key press, and until then `playChime()` stays silent. On iPhone it
 * follows the ring/silent switch, like any app sound.
 */
let audio: AudioContext | null = null;

function unlock(): void {
  if (!audio) {
    const Context =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio = new Context();
  }
  void audio.resume().catch(() => undefined);
}

/** Starts listening for the first tap; returns the cleanup for an effect. */
export function listenForTaps(): () => void {
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

/** A5 then E6, soft attack and a half-second tail; a short buzz on phones that vibrate. */
export function playChime(): void {
  navigator.vibrate?.([60, 40, 60]);
  const ctx = audio;
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  [880, 1318.5].forEach((frequency, i) => {
    const at = start + i * 0.14;
    const tone = ctx.createOscillator();
    const volume = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, at);
    volume.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    tone.connect(volume).connect(ctx.destination);
    tone.start(at);
    tone.stop(at + 0.5);
  });
}
