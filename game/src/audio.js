// Synthesised audio: every sound in the game is built from an oscillator and a noise
// buffer at call time, so the entry ships no audio files and no sound is borrowed.
// The context is created on the first gesture — before that the browser would only
// suspend it, and a headless render should not start one at all.
let ctx = null;
let master = null;
let noiseBuffer = null;

function noiseSource() {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 1073741823 - 1) * 0.9;
  }
  return buffer;
}

function ensure() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  noiseBuffer = noiseSource();
  return ctx;
}

function burst(duration, gain, cutoff, q = 1, type = 'lowpass') {
  if (!ensure()) return;
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = cutoff;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, now);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(env).connect(master);
  source.start(now);
  source.stop(now + duration);
}

function tone(from, to, duration, type, gain) {
  if (!ensure()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(gain, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(env).connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function createAudio() {
  return {
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot(kind) {
      if (kind === 'pistol') {
        burst(0.12, 0.8, 2400, 0.8);
        tone(190, 70, 0.12, 'triangle', 0.5);
      } else if (kind === 'smg') {
        burst(0.1, 0.6, 1800, 0.9);
        tone(160, 60, 0.1, 'triangle', 0.4);
      } else {
        burst(0.17, 0.95, 1300, 0.7);
        tone(120, 45, 0.2, 'triangle', 0.65);
      }
    },
    hit() {
      tone(1500, 900, 0.05, 'square', 0.09);
    },
    kill() {
      tone(700, 1180, 0.12, 'triangle', 0.14);
    },
    reload() {
      burst(0.045, 0.18, 2600, 3);
    },
    explode() {
      burst(0.6, 1.0, 420, 0.6);
      tone(130, 28, 0.55, 'sine', 0.7);
    },
    beep(urgent) {
      tone(urgent ? 1860 : 1320, urgent ? 1860 : 1320, 0.07, 'square', 0.07);
    },
    empty() {
      burst(0.028, 0.14, 3400, 4);
    },
  };
}
