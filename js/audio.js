// audio.js — Web Audio engine: buffered SFX with distance/pan/delay, music crossfades,
// ambience loops, slow-motion pitch bending and volume buses.
import { clamp } from './core.js';

const SFX = [
  'rifle_shot', 'enemy_shot', 'bolt', 'reload', 'dry_fire', 'ricochet', 'whiz', 'impact_body', 'headshot',
  'impact_wood', 'impact_dirt', 'impact_metal', 'explosion', 'scope_in', 'scope_out', 'ui_click', 'ui_hover',
  'coin', 'cash', 'heartbeat', 'breath_in', 'breath_out', 'deadeye', 'hurt', 'bell', 'horse', 'train_whistle',
  'victory', 'defeat', 'star', 'wind_loop',
];
const MUSIC = ['theme_menu', 'theme_battle'];

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = new Map();
    this.music = null;
    this.musicName = null;
    this.loops = new Map();
    this.active = new Set();
    this.rate = 1;
    this.unlocked = false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    // Low-pass on the SFX bus for muffled audio when hurt / in slow motion
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.ratio.value = 4;
    this.sfxBus.connect(this.filter).connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.compressor).connect(this.ctx.destination);
    this.applyVolumes();
  }

  async load(onProgress) {
    if (!this.ctx) return;
    const all = [...SFX.map((n) => ['sfx', n]), ...MUSIC.map((n) => ['music', n])];
    let done = 0;
    await Promise.all(all.map(async ([dir, name]) => {
      try {
        const res = await fetch(`assets/audio/${dir}/${name}.mp3`);
        const arr = await res.arrayBuffer();
        const buf = await new Promise((resolve, reject) => this.ctx.decodeAudioData(arr, resolve, reject));
        this.buffers.set(name, buf);
      } catch (e) {
        console.warn('audio failed', name, e);
      }
      done++;
      onProgress && onProgress(done / all.length);
    }));
  }

  unlock() {
    if (!this.ctx || this.unlocked) return;
    this.ctx.resume();
    this.unlocked = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.sfxBus.gain.value = s.sfx;
    this.musicBus.gain.value = s.music * 0.7;
  }

  /**
   * Play a one-shot effect.
   * opts: volume, rate, pan (-1..1), delay (s), distance (m: attenuates + delays like sound travel), detune (random rate spread)
   */
  play(name, opts = {}) {
    if (!this.ctx || !this.unlocked) return null;
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    let vol = opts.volume ?? 1;
    let delay = opts.delay ?? 0;
    if (opts.distance != null) {
      vol *= clamp(28 / (opts.distance + 18), 0.12, 1);
      if (opts.soundTravel !== false) delay += opts.distance / 343 / Math.max(0.25, this.rate);
    }
    const spread = opts.detune ?? 0.05;
    const baseRate = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * spread);
    src.playbackRate.value = baseRate * (opts.ignoreSlowmo ? 1 : this.rate);
    src._baseRate = baseRate;
    src._ignoreSlowmo = !!opts.ignoreSlowmo;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    let node = src.connect(gain);
    if (opts.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(opts.pan, -1, 1);
      node = node.connect(p);
    }
    node.connect(opts.bus === 'music' ? this.musicBus : this.sfxBus);
    src.start(this.ctx.currentTime + delay);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
    return src;
  }

  loop(name, volume = 1, fade = 1.0) {
    if (!this.ctx || this.loops.has(name)) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + fade);
    src.connect(g).connect(this.sfxBus);
    src.start();
    this.loops.set(name, { src, g });
  }
  stopLoop(name, fade = 0.8) {
    const l = this.loops.get(name);
    if (!l) return;
    const t = this.ctx.currentTime;
    l.g.gain.cancelScheduledValues(t);
    l.g.gain.setValueAtTime(l.g.gain.value, t);
    l.g.gain.linearRampToValueAtTime(0, t + fade);
    l.src.stop(t + fade + 0.05);
    this.loops.delete(name);
  }
  setLoopVolume(name, v) {
    const l = this.loops.get(name);
    if (l) l.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  playMusic(name, fade = 1.5) {
    if (!this.ctx || this.musicName === name) return;
    const buf = this.buffers.get(name);
    const t = this.ctx.currentTime;
    if (this.music) {
      const old = this.music;
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setValueAtTime(old.g.gain.value, t);
      old.g.gain.linearRampToValueAtTime(0, t + fade);
      old.src.stop(t + fade + 0.1);
      this.music = null;
    }
    this.musicName = name;
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(1, t + fade);
    src.connect(g).connect(this.musicBus);
    src.start();
    this.music = { src, g };
  }
  stopMusic(fade = 1.0) { this.playMusic(null, fade); this.musicName = null; }

  // Slow motion: bend pitch of all playing sounds and muffle the mix.
  setTimeScale(scale) {
    if (!this.ctx) return;
    const r = clamp(0.35 + scale * 0.65, 0.35, 1);
    if (Math.abs(r - this.rate) < 0.01) return;
    this.rate = r;
    for (const s of this.active) if (!s._ignoreSlowmo) s.playbackRate.setTargetAtTime(s._baseRate * r, this.ctx.currentTime, 0.05);
    if (this.music) this.music.src.playbackRate.setTargetAtTime(scale < 0.9 ? 0.85 : 1, this.ctx.currentTime, 0.2);
  }
  setMuffle(amount) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(1 - clamp(amount, 0, 0.95), 2.5) + 400;
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }
  stopAll() {
    for (const s of this.active) { try { s.stop(); } catch (e) { /* already stopped */ } }
    this.active.clear();
  }
}
