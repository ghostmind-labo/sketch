// A stylus writing on glass, synthesised: looped noise through a band-pass whose loudness and
// brightness follow pen speed, plus a soft tap when the tip lands. No audio files, no network.
//
// Browsers only let audio start from a user gesture, so the AudioContext is created lazily by
// resume(), which callers invoke from click handlers. Until then every call is a no-op.

export interface Scratch {
  /** Pen speed in board units per second; `active` is false while the pen is lifted. */
  set(speed: number, active: boolean): void;
  /** The tip touching down at the start of a stroke. */
  tap(): void;
  /** Creates or wakes the audio graph; call from a user gesture. */
  resume(): void;
  close(): void;
}

type AudioCtor = typeof AudioContext;

export function createScratch(): Scratch | null {
  const AC: AudioCtor | undefined =
    typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!AC) return null;

  let ctx: AudioContext | null = null;
  let noise: AudioBuffer;
  let gain: GainNode;
  let band: BiquadFilterNode;

  function init(): AudioContext {
    if (ctx) return ctx;
    ctx = new AC!();
    const rate = ctx.sampleRate;
    noise = ctx.createBuffer(1, rate * 2, rate);
    const data = noise.getChannelData(0);
    // White noise with a slow grain: short bursts of extra roughness, like a tip catching the surface.
    let grain = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 220 === 0) grain = 0.6 + Math.random() * 0.8;
      data[i] = (Math.random() * 2 - 1) * grain;
    }

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 700;
    band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 0.8;
    gain = ctx.createGain();
    gain.gain.value = 0;
    const master = ctx.createGain();
    master.gain.value = 0.32;

    src.connect(high).connect(band).connect(gain).connect(master).connect(ctx.destination);
    src.start();
    return ctx;
  }

  return {
    set(speed, active) {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const v = Math.min(1, Math.max(0, speed / 1400));
      const level = active ? Math.pow(v, 0.7) * (0.8 + Math.random() * 0.35) : 0;
      gain.gain.setTargetAtTime(level, now, active ? 0.012 : 0.02);
      band.frequency.setTargetAtTime(1700 + 2600 * v, now, 0.03);
    },
    tap() {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const low = ctx.createBiquadFilter();
      low.type = 'bandpass';
      low.frequency.value = 1100 + Math.random() * 500;
      low.Q.value = 1.4;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.5, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      src.connect(low).connect(env).connect(ctx.destination);
      src.start(now, Math.random() * 1.5, 0.06);
    },
    resume() {
      init().resume().catch(() => {});
    },
    close() {
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
