// Synthesizes the soundtrack for promo/intro.html as a 44.1kHz stereo WAV.
// Everything is timed against the same scene timeline as the HTML (scenes at
// 0/4/10/15/22/27/32/36s, total 40.5s) so SFX land on the exact frames.
// 120 BPM => 1 bar = 2s, so every scene cut lands on a downbeat.
try { process.loadEnvFile(".env") } catch {}
import fs from "fs";

const SR = 44100;
const DUR = 43.0;
const N = Math.ceil(SR * DUR);
const L = new Float64Array(N);
const R = new Float64Array(N);

const TAU = Math.PI * 2;

function add(i: number, v: number, pan = 0) {
  if (i < 0 || i >= N) return;
  const l = pan <= 0 ? 1 : 1 - pan;
  const r = pan >= 0 ? 1 : 1 + pan;
  L[i] += v * l;
  R[i] += v * r;
}

interface ToneOpts {
  t: number; dur: number; f0: number; f1?: number;
  gain: number; pan?: number; wave?: "sine" | "tri" | "saw";
  attack?: number; tau?: number; // exp decay time constant
}
function tone(o: ToneOpts) {
  const i0 = Math.floor(o.t * SR);
  const n = Math.floor(o.dur * SR);
  const f1 = o.f1 ?? o.f0;
  const attack = o.attack ?? 0.004;
  const tau = o.tau ?? o.dur;
  let ph = Math.random() * TAU;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    const f = o.f0 * Math.pow(f1 / o.f0, x);
    ph += (TAU * f) / SR;
    let s: number;
    const p = ph / TAU;
    if (o.wave === "tri") s = 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
    else if (o.wave === "saw") s = 2 * (p - Math.floor(p + 0.5));
    else s = Math.sin(ph);
    const tSec = k / SR;
    let env = Math.min(1, tSec / attack) * Math.exp(-tSec / tau);
    if (n - k < 882) env *= (n - k) / 882; // 20ms anti-click tail
    add(i0 + k, s * env * o.gain, o.pan ?? 0);
  }
}

interface NoiseOpts {
  t: number; dur: number; gain: number; pan?: number;
  lp0?: number; lp1?: number; // lowpass cutoff sweep (Hz)
  hp?: number;               // highpass cutoff (Hz)
  attack?: number; tau?: number;
}
function noise(o: NoiseOpts) {
  const i0 = Math.floor(o.t * SR);
  const n = Math.floor(o.dur * SR);
  const lp0 = o.lp0 ?? 8000, lp1 = o.lp1 ?? lp0;
  const attack = o.attack ?? 0.003;
  const tau = o.tau ?? o.dur;
  let lpS = 0, hpLpS = 0;
  const hpA = o.hp ? 1 - Math.exp((-TAU * o.hp) / SR) : 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    const fc = lp0 * Math.pow(lp1 / lp0, x);
    const a = 1 - Math.exp((-TAU * fc) / SR);
    let s = Math.random() * 2 - 1;
    lpS += a * (s - lpS);
    s = lpS;
    if (o.hp) { hpLpS += hpA * (s - hpLpS); s = s - hpLpS; }
    const tSec = k / SR;
    let env = Math.min(1, tSec / attack) * Math.exp(-tSec / tau);
    if (n - k < 441) env *= (n - k) / 441;
    add(i0 + k, s * env * o.gain, o.pan ?? 0);
  }
}

// ---------- instruments ----------
const kick = (t: number, g = 0.5) => {
  tone({ t, dur: 0.3, f0: 130, f1: 42, gain: g, tau: 0.09 });
  tone({ t, dur: 0.06, f0: 900, f1: 250, gain: g * 0.35, tau: 0.02 }); // mid punch
  noise({ t, dur: 0.025, gain: g * 0.5, lp0: 5000, tau: 0.01 });
};
const hat = (t: number, open = false, g = 0.09) =>
  noise({ t, dur: open ? 0.18 : 0.045, gain: g, hp: 7500, lp0: 12000, tau: open ? 0.07 : 0.014 });
const clap = (t: number, g = 0.16) => {
  for (const d of [0, 0.012, 0.026]) noise({ t: t + d, dur: 0.05, gain: g * 0.6, hp: 1100, lp0: 4500, tau: 0.02 });
  noise({ t: t + 0.03, dur: 0.2, gain: g, hp: 1100, lp0: 4000, tau: 0.06 });
};
const thud = (t: number, big = false) => {
  tone({ t, dur: 0.4, f0: big ? 110 : 95, f1: 38, gain: big ? 0.55 : 0.4, tau: 0.12 });
  tone({ t, dur: 0.08, f0: 320, f1: 130, gain: big ? 0.3 : 0.22, tau: 0.035 }); // audible knock
  noise({ t, dur: 0.1, gain: big ? 0.5 : 0.35, lp0: 3500, lp1: 400, tau: 0.04 });
};
const pop = (t: number, f = 600, g = 0.16, pan = 0) =>
  tone({ t, dur: 0.09, f0: f, f1: f * 0.55, gain: g * 2, pan, tau: 0.035 });
const blip = (t: number, f0 = 800, f1 = 1500, g = 0.09, pan = 0) =>
  tone({ t, dur: 0.1, f0, f1, gain: g * 2, pan, tau: 0.05, wave: "tri" });
const ding = (t: number, f = 1318.5, g = 0.12) => {
  tone({ t, dur: 0.9, f0: f, gain: g * 2, tau: 0.28 });
  tone({ t, dur: 0.9, f0: f * 1.498, gain: g, tau: 0.22 });
};
const whoosh = (t: number, g = 0.3) =>
  noise({ t, dur: 0.55, gain: g, lp0: 350, lp1: 5200, hp: 180, attack: 0.18, tau: 0.45 });
const riser = (t: number, dur: number, g = 0.22) => {
  noise({ t, dur, gain: g, lp0: 400, lp1: 7000, hp: 200, attack: dur * 0.75, tau: dur });
  tone({ t, dur, f0: 146.8, f1: 293.7, gain: g * 0.4, wave: "saw", attack: dur * 0.7, tau: dur });
};
const typing = (t: number, dur: number, g = 0.06, pan = 0.2) => {
  let tt = t;
  while (tt < t + dur) {
    noise({ t: tt, dur: 0.015, gain: g * 2 * (0.7 + Math.random() * 0.6), hp: 2500, lp0: 9000, tau: 0.005, pan });
    tt += 0.05 + Math.random() * 0.045;
  }
};
const tickRoll = (t: number, dur: number, g = 0.035, pan = 0) => {
  let tt = t;
  while (tt < t + dur) {
    noise({ t: tt, dur: 0.01, gain: g * 2, hp: 4000, lp0: 10000, tau: 0.004, pan });
    tt += 0.055;
  }
};

// ---------- music bed ----------
// D minor, 120 BPM. 8s chord blocks: Dm -> Bb -> F -> C -> Dm...
const CHORDS = [
  { root: 73.42, pad: [220.0, 293.66, 349.23] },   // Dm
  { root: 58.27, pad: [233.08, 293.66, 349.23] },  // Bb
  { root: 87.31, pad: [220.0, 261.63, 349.23] },   // F
  { root: 65.41, pad: [196.0, 261.63, 329.63] },   // C
];
const chordAt = (t: number) => CHORDS[Math.floor(t / 8) % 4];

// pads: slow detuned triangles per 8s block
for (let b = 0; b * 8 < 42; b++) {
  const t = b * 8;
  const ch = CHORDS[b % 4];
  const last = (t + 8) > 40.5;
  const dur = last ? DUR - t - 0.2 : 8.6; // overlap blocks slightly
  for (const f of ch.pad) {
    for (const det of [0.996, 1.004]) {
      tone({ t, dur, f0: f * det, gain: 0.07, wave: "tri", attack: 1.4, tau: dur * 0.9, pan: det < 1 ? -0.3 : 0.3 });
    }
  }
}

// sub bass: per-block root sine with a sidechain-style pump keyed to the 1s kick grid
{
  const i0 = 0, i1 = Math.floor(42.2 * SR);
  let ph = 0;
  for (let i = i0; i < i1; i++) {
    const t = i / SR;
    const f = chordAt(t).root;
    ph += (TAU * f) / SR;
    let g = 0.1;
    if (t > 4 && t < 36.2) {
      const ph1 = (t - 4) % 1; // kick every 1s
      g *= 0.35 + 0.65 * Math.min(1, ph1 / 0.32);
    }
    // global shape: fade in over 1.2s, fade out at the end
    g *= Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (42.2 - t) / 2.5));
    // octave + 12th harmonics so the bassline reads on small speakers
    add(i, (Math.sin(ph) + 0.55 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) * g);
  }
}

// drums
for (let t = 4; t < 36; t += 1) kick(t, t < 10 ? 0.42 : 0.5);
for (let t = 10; t < 36; t += 0.5) hat(t + 0.25, false, 0.08);
for (let t = 10; t < 36; t += 2) hat(t + 1.75, true, 0.06);
for (let t = 22; t < 36; t += 2) clap(t + 1, 0.16);

// arp: 16ths over chord tones, octave up, ping-pong panned
{
  const pat = [0, 1, 2, 1, 0, 2, 1, 2];
  let k = 0;
  for (let t = 10; t < 36; t += 0.125, k++) {
    const ch = chordAt(t);
    const f = ch.pad[pat[k % 8]] * 2;
    const accent = k % 4 === 0 ? 1.3 : 1;
    tone({ t, dur: 0.16, f0: f, gain: 0.055 * accent, wave: "tri", tau: 0.07, pan: k % 2 ? 0.45 : -0.45 });
  }
}

// section punctuation
kick(4.0, 0.6); // groove drop
riser(8.9, 1.1, 0.1);
riser(34.5, 1.5, 0.16);
thud(36.0, true); // final downbeat
tone({ t: 36.0, dur: 4, f0: 36.71, gain: 0.16, tau: 2.2 }); // D1 tail
tone({ t: 36.0, dur: 4, f0: 146.83, gain: 0.1, wave: "tri", tau: 2.0 }); // audible D3 tail

// scene-cut whooshes (36 covered by riser+thud)
for (const t of [4, 10, 15, 22, 27, 32]) whoosh(t);

// ---------- SFX, timed to scene-element animation delays ----------
// S2 discover (4s): job cards land at scene+0.55..2.8 (0.45 apart)
for (let i = 0; i < 6; i++) {
  const t = 4 + 0.55 + i * 0.45;
  noise({ t: t - 0.06, dur: 0.12, gain: 0.1, lp0: 1200, lp1: 4500, hp: 300, attack: 0.05, tau: 0.1, pan: 0.35 });
  pop(t + 0.05, 520 + i * 30, 0.08, 0.35);
}
tickRoll(4.6, 3.0, 0.03, -0.4); // lead counter ramping

// S3 score (10s): three dials fill +0.5/.62/.74 and count up with a cubic
// ease-out, so each number LANDS at ~82% of its 1.5s (hot 92 ~11.73, good 84
// ~11.85, cold 41 ~11.90), not at the start. Sync the ear to the count: soft
// ticks as each dial begins, an audible roll across the fill, then a bright
// "land" accent when each passing number settles (hot glow +1.7 rides the hot
// landing). The cold/below-threshold dial gets no positive accent — its result
// is the SKIP stamp + sour note at +2.25.
blip(10.5, 600, 1400, 0.08, -0.35);  // hot dial starts
blip(10.62, 600, 1400, 0.08, 0);     // good dial starts
blip(10.74, 600, 1000, 0.08, 0.35);  // cold dial starts
tickRoll(10.5, 1.45, 0.05);          // counting roll, audible across the whole fill
ding(11.73, 1318.5, 0.1); // hot 92 lands — strong fit (+ glow)
ding(11.85, 987.77, 0.07); // good 84 lands
thud(12.25); // SKIP
tone({ t: 12.25, dur: 0.25, f0: 220, f1: 180, gain: 0.07, wave: "saw", tau: 0.1 }); // sour note

// S4 tailor (15s): keywords +1.1..2.3 (.3 apart), bullets type +1.3/2.2/3.1, chips +3.7/.9/4.1, seal +4.6
for (let i = 0; i < 5; i++) blip(15 + 1.1 + i * 0.3, 900, 1350, 0.07, -0.3);
for (const d of [1.3, 2.2, 3.1]) typing(15 + d, 0.85, 0.05, 0.3);
for (let i = 0; i < 3; i++) pop(15 + 3.7 + i * 0.2, 700 + i * 120, 0.1, 0.3);
thud(15 + 4.6); thud(15 + 4.72); // double stamp knock
ding(15 + 4.78, 987.77, 0.07);

// S5 email (22s): found-ping +0.9, subject types +1.2, body lines +1.7/2.3/2.9, draft badge +3.4
blip(22.9, 1200, 1900, 0.09, 0.3);
typing(23.2, 0.95, 0.055, 0.25);
for (const d of [1.7, 2.3, 2.9]) typing(22 + d, 0.95, 0.05, 0.25);
ding(25.4, 880, 0.08); ding(25.52, 1108.7, 0.06); // two-tone draft notify

// S6 apply (27s): fields fill +0.8/1.4/2.0/2.6, hold stamp +3.4
for (let i = 0; i < 4; i++) {
  const t = 27 + 0.8 + i * 0.6;
  blip(t, 500, 950, 0.08, 0.3);
  typing(t + 0.04, 0.4, 0.045, 0.3);
}
pop(29.1, 400, 0.1, 0.3); // resume attach
thud(30.4, true); thud(30.55); // PAUSED FOR YOUR REVIEW
noise({ t: 30.4, dur: 0.3, gain: 0.2, lp0: 5000, lp1: 600, hp: 250, tau: 0.12 }); // air brake

// S7 track (32s): cards pop +0.5..1.7, flip flash +2.2
for (let i = 0; i < 7; i++) pop(32 + 0.5 + i * 0.2, 560 + i * 40, 0.07, i % 2 ? 0.3 : -0.3);
tickRoll(32.6, 1.2, 0.025);
ding(34.2, 1567.98, 0.1); // founder replied

// S8 outro (36s): chips +0.1..0.6, wordmark +0.9, CTA +1.5
for (let i = 0; i < 6; i++) pop(36 + 0.1 + i * 0.1, 500 * Math.pow(2, i / 12 * 2), 0.09, (i - 2.5) * 0.16);
ding(36.9, 587.33, 0.13); ding(36.9, 880, 0.09); // wordmark chord
ding(37.5, 1760, 0.08); // CTA

// ---------- master: normalize + gentle saturation + final fade ----------
{
  const fadeStart = 41.3 * SR;
  for (let i = 0; i < N; i++) {
    if (i > fadeStart) {
      const f = Math.max(0, 1 - (i - fadeStart) / ((DUR - 41.3) * SR));
      L[i] *= f * f; R[i] *= f * f;
    }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = 0.95 / peak;
  for (let i = 0; i < N; i++) {
    L[i] = Math.tanh(L[i] * k * 1.25) / Math.tanh(1.25);
    R[i] = Math.tanh(R[i] * k * 1.25) / Math.tanh(1.25);
  }
}

// ---------- write 16-bit stereo WAV ----------
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(data.length, 40);
fs.writeFileSync("promo/intro-audio.wav", Buffer.concat([hdr, data]));
console.log("wrote promo/intro-audio.wav", (43).toFixed(1) + "s");
