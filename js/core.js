// core.js — math helpers, RNG/noise, storage, event bus, input and hit-test geometry.
import * as THREE from 'three';

// ------------------------------------------------------------------ math
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInQuad = (t) => t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const DEG = Math.PI / 180;

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function weightedPick(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = Math.random() * total;
  for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
  return Object.keys(weights)[0];
}

// Deterministic RNG (mulberry32) for daily challenges and layout variation.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Smooth 1D value noise in [-1, 1]; used for scope sway and wind gusts.
const NOISE_TABLE = (() => { const r = seededRandom(77); return Array.from({ length: 256 }, () => r() * 2 - 1); })();
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const a = NOISE_TABLE[i & 255], b = NOISE_TABLE[(i + 1) & 255];
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

// ------------------------------------------------------------------ formatting
export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(keyA, keyB) {
  const a = new Date(keyA + 'T00:00:00'), b = new Date(keyB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// ------------------------------------------------------------------ storage
export const Storage = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  },
};

// ------------------------------------------------------------------ events
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  emit(type, payload) { this.map.get(type)?.forEach((fn) => fn(payload)); }
}

// ------------------------------------------------------------------ tweens (UI + camera)
export class Tweens {
  constructor() { this.list = []; }
  add({ duration, update, ease = (t) => t, done, delay = 0 }) {
    const tw = { t: -delay, duration, update, ease, done, dead: false };
    this.list.push(tw);
    return tw;
  }
  update(dt) {
    for (const tw of this.list) {
      if (tw.dead) continue;
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = clamp(tw.t / tw.duration, 0, 1);
      tw.update(tw.ease(k));
      if (k >= 1) { tw.dead = true; tw.done && tw.done(); }
    }
    this.list = this.list.filter((t) => !t.dead);
  }
  clear() { this.list.length = 0; }
}

// ------------------------------------------------------------------ input
export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, left: false, right: false, leftPressed: false, rightPressed: false, rightReleased: false, leftReleased: false };
    this.locked = false;
    this.enabled = true;
    this.events = new EventBus();

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.captureKeys) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.events.emit('keydown', e);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
      this.events.emit('keyup', e);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; this.events.emit('blur'); });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      // Browsers emit a bogus jump right after pointer lock changes; also drop spikes.
      if (this.skipMoves > 0) { this.skipMoves--; return; }
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > 350 || Math.abs(my) > 350) return;
      this.mouse.dx += mx; this.mouse.dy += my;
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      this.events.emit('mousedown', e);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.mouse.leftReleased = true; }
      if (e.button === 2) { this.mouse.right = false; this.mouse.rightReleased = true; }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === target;
      this.skipMoves = 2;
      this.mouse.dx = this.mouse.dy = 0;
      this.events.emit('lockchange', this.locked);
    });
  }
  requestLock() {
    if (this.locked || !this.target.requestPointerLock) return;
    try {
      const p = this.target.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.target.requestPointerLock(); } catch (e) { /* unsupported */ } });
    } catch (e) { /* pointer lock unsupported: free-cursor aiming still works */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  resetMouse() { this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0; this.skipMoves = 1; }
  isDown(...codes) { return codes.some((c) => this.down.has(c)); }
  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  wasReleased(...codes) { return codes.some((c) => this.released.has(c)); }
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = this.mouse.leftReleased = this.mouse.rightReleased = false;
  }
}

// ------------------------------------------------------------------ hit-test geometry
// Segment (origin o, unit dir d, length len) vs sphere. Returns distance along d or -1.
export function segSphere(o, d, len, c, r) {
  const mx = o.x - c.x, my = o.y - c.y, mz = o.z - c.z;
  const b = mx * d.x + my * d.y + mz * d.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= len ? t : -1;
}

const _ab = new THREE.Vector3(), _ao = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
// Segment vs capsule (a-b, radius r): closest-approach test between the two segments.
export function segCapsule(o, d, len, a, b, r) {
  _ab.subVectors(b, a);
  _ao.subVectors(o, a);
  const abab = _ab.dot(_ab), abd = _ab.dot(d), abao = _ab.dot(_ao), dao = d.dot(_ao);
  const denom = abab - abd * abd;
  // Closest points between segment o+d*t (t∈[0,len]) and a+ab*s (s∈[0,1]), with clamping.
  let s = denom > 1e-8 ? clamp((abao - abd * dao) / denom, 0, 1) : 0;
  let t;
  t = clamp(abd * s - dao, 0, len);
  s = abab > 1e-8 ? clamp((abd * t + abao) / abab, 0, 1) : 0;
  _p.copy(d).multiplyScalar(t).add(o);
  _q.copy(_ab).multiplyScalar(s).add(a);
  if (_p.distanceToSquared(_q) > r * r) return -1;
  // refine entry point by stepping back toward the segment start
  const back = Math.sqrt(Math.max(0, r * r - _p.distanceToSquared(_q)));
  return Math.max(0, t - back);
}

// Project a world position to screen pixels; returns null when behind the camera.
const _proj = new THREE.Vector3();
export function toScreen(pos, camera, w, h, out = {}) {
  _proj.copy(pos).project(camera);
  if (_proj.z > 1) return null;
  out.x = (_proj.x * 0.5 + 0.5) * w;
  out.y = (-_proj.y * 0.5 + 0.5) * h;
  out.inside = Math.abs(_proj.x) <= 1 && Math.abs(_proj.y) <= 1;
  out.ndcX = _proj.x; out.ndcY = _proj.y;
  return out;
}
