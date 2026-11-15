// Every sound in the station, synthesized in WebAudio: no files, no network. A shared noise
// buffer feeds the gunshots, footsteps and blasts through filters and envelopes; the beeps and
// tones are oscillators. Voices are created per sound and let go — audio nodes are cheap and
// garbage-collected, unlike three.js scene objects, and none of this runs in the sim loop.
const NOISE_SECONDS = 1;

function makeNoiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise: the same crackle every session.
  let seed = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 2147483648 - 1) * 0.85;
  }
  return buffer;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;

  function ensure() {
    if (ctx === null) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      noise = makeNoiseBuffer(ctx);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(gainNode, when, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    g.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  function noiseBurst({ when, peak, attack, decay, type, freq, q, sweepTo }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, when);
    if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(sweepTo, when + attack + decay);
    filter.Q.value = q;
    const gain = ctx.createGain();
    env(gain, when, peak, attack, decay);
    src.connect(filter).connect(gain).connect(master);
    src.start(when);
    src.stop(when + attack + decay + 0.05);
  }

  function tone({ when, peak, attack, decay, type, from, to }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, when);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(to, when + attack + decay);
    const gain = ctx.createGain();
    env(gain, when, peak, attack, decay);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + attack + decay + 0.05);
  }

  /** Scale a voice by distance from the listener. */
  const falloff = (dist, span) => Math.max(0.06, Math.min(1, 1 - dist / span));

  return {
    ensure,
    /** distance is metres from the player's ear; 0 is the player's own weapon. */
    gunshot(distance, heavy) {
      if (!ensure()) return;
      const when = ctx.currentTime;
      const v = falloff(distance, 70);
      noiseBurst({ when, peak: 0.5 * v, attack: 0.002, decay: heavy ? 0.3 : 0.14, type: 'bandpass', freq: heavy ? 900 : 1500, q: 0.8 });
      noiseBurst({ when, peak: 0.32 * v, attack: 0.001, decay: 0.07, type: 'lowpass', freq: 2600, q: 0.5 });
      tone({ when, peak: 0.3 * v, attack: 0.002, decay: 0.1, type: 'triangle', from: heavy ? 110 : 150, to: 55 });
    },
    footstep(distance) {
      if (!ensure()) return;
      const v = falloff(distance, 32);
      noiseBurst({ when: ctx.currentTime, peak: 0.16 * v, attack: 0.002, decay: 0.08, type: 'lowpass', freq: 750, q: 0.6 });
    },
    reload(stage) {
      if (!ensure()) return;
      const when = ctx.currentTime;
      noiseBurst({ when, peak: 0.18, attack: 0.002, decay: 0.05, type: 'bandpass', freq: stage ? 2100 : 1400, q: 2 });
      tone({ when: when + 0.02, peak: 0.12, attack: 0.002, decay: 0.06, type: 'square', from: stage ? 520 : 360, to: stage ? 640 : 300 });
    },
    dryClick() {
      if (!ensure()) return;
      noiseBurst({ when: ctx.currentTime, peak: 0.12, attack: 0.001, decay: 0.03, type: 'highpass', freq: 2400, q: 1 });
    },
    beep(urgency) {
      if (!ensure()) return;
      tone({ when: ctx.currentTime, peak: 0.22, attack: 0.002, decay: 0.06, type: 'square', from: 620 + urgency * 500, to: 620 + urgency * 500 });
    },
    explosion(distance) {
      if (!ensure()) return;
      const when = ctx.currentTime;
      const v = falloff(distance, 90);
      noiseBurst({ when, peak: 0.8 * v, attack: 0.004, decay: 0.65, type: 'lowpass', freq: 2200, q: 0.6, sweepTo: 140 });
      tone({ when, peak: 0.55 * v, attack: 0.003, decay: 0.5, type: 'triangle', from: 120, to: 36 });
    },
    flashbang(distance) {
      if (!ensure()) return;
      const v = falloff(distance, 60);
      noiseBurst({ when: ctx.currentTime, peak: 0.7 * v, attack: 0.002, decay: 0.35, type: 'highpass', freq: 1800, q: 0.7 });
      tone({ when: ctx.currentTime, peak: 0.3 * v, attack: 0.002, decay: 0.4, type: 'sine', from: 2800, to: 5200 });
    },
    hit(headshot) {
      if (!ensure()) return;
      tone({ when: ctx.currentTime, peak: 0.25, attack: 0.001, decay: 0.05, type: 'sine', from: headshot ? 1500 : 1050, to: headshot ? 900 : 700 });
    },
    death() {
      if (!ensure()) return;
      const when = ctx.currentTime;
      tone({ when, peak: 0.3, attack: 0.004, decay: 0.5, type: 'triangle', from: 420, to: 90 });
    },
    buy() {
      if (!ensure()) return;
      const when = ctx.currentTime;
      tone({ when, peak: 0.2, attack: 0.002, decay: 0.08, type: 'sine', from: 780, to: 780 });
      tone({ when: when + 0.09, peak: 0.2, attack: 0.002, decay: 0.12, type: 'sine', from: 1170, to: 1170 });
    },
    roundStart() {
      if (!ensure()) return;
      const when = ctx.currentTime;
      tone({ when, peak: 0.24, attack: 0.01, decay: 0.3, type: 'triangle', from: 330, to: 330 });
      tone({ when: when + 0.16, peak: 0.24, attack: 0.01, decay: 0.42, type: 'triangle', from: 495, to: 495 });
    },
    roundEnd(won) {
      if (!ensure()) return;
      const when = ctx.currentTime;
      const base = won ? 392 : 262;
      tone({ when, peak: 0.26, attack: 0.01, decay: 0.35, type: 'triangle', from: base, to: base });
      tone({ when: when + 0.18, peak: 0.26, attack: 0.01, decay: 0.5, type: 'triangle', from: won ? 588 : 196, to: won ? 588 : 196 });
    },
  };
}
