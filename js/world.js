// world.js — environment: sky, lighting presets, terrain, procedural western architecture,
// the three territory layouts, props, ambient life, the train, spawn points and the FX system.
import * as THREE from 'three';
import { rand, pick, chance, smoothstep, seededRandom, DEG } from './core.js';
import { mergeMeshes } from './assets.js';

const INTERIOR_DARK = new THREE.MeshBasicMaterial({ color: '#0c0806' });
const INTERIOR_LIT = ['#ffb15a', '#ffa040', '#ffc070'].map((c) => new THREE.MeshBasicMaterial({ color: c }));
const CURTAINS = ['#7a2a24', '#c8b48a', '#3a4a6a', '#6a5a3a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide }));
for (const m of [INTERIOR_DARK, ...INTERIOR_LIT, ...CURTAINS]) m.userData.shared = true;

// ------------------------------------------------------------------ time of day presets
export const TIME_PRESETS = {
  noon: {
    skyTop: '#2f6fc0', skyHorizon: '#f1d6ac', ground: '#b98a5c', sunDir: [0.45, 0.78, 0.55], sunColor: '#fff0d4', sunIntensity: 3.4,
    sunDisk: '#fff6e0', hemiSky: '#c4dcf6', hemiGround: '#b0805a', hemiIntensity: 0.8, fog: '#e9d3b0', fogNear: 260, fogFar: 1700,
    exposure: 0.95, mesaNear: '#c98557', mesaFar: '#d8ab86', stars: 0, cloud: 0.55, lamps: false, windowsLit: 0, ambientDust: 0.6,
  },
  sunset: {
    skyTop: '#2b386e', skyHorizon: '#ff9448', ground: '#7a4a32', sunDir: [-0.62, 0.17, -0.77], sunColor: '#ffa860', sunIntensity: 3.0,
    sunDisk: '#ffd9a0', hemiSky: '#ffb49a', hemiGround: '#6a3a2a', hemiIntensity: 0.7, fog: '#e58e5e', fogNear: 180, fogFar: 1300,
    exposure: 1.0, mesaNear: '#8a3e2c', mesaFar: '#c4664a', stars: 0.05, cloud: 0.8, lamps: true, windowsLit: 0.35, ambientDust: 0.8,
  },
  night: {
    skyTop: '#03081a', skyHorizon: '#1b2a4c', ground: '#1a1a22', sunDir: [0.35, 0.62, -0.5], sunColor: '#8fa8ff', sunIntensity: 0.9,
    sunDisk: '#dfe8ff', hemiSky: '#4a5c9a', hemiGround: '#1c1814', hemiIntensity: 0.45, fog: '#101a30', fogNear: 90, fogFar: 760,
    exposure: 1.15, mesaNear: '#1a2036', mesaFar: '#24304e', stars: 1, cloud: 0.25, lamps: true, windowsLit: 0.7, ambientDust: 0.25,
  },
};

const SURFACE_BY_MAT = { iron: 'metal', steel: 'metal', brass: 'metal', gunBlue: 'metal', tin: 'metal', rock: 'stone', adobe: 'stone', brick: 'stone', water: 'water' };

// ------------------------------------------------------------------ sky
function makeSky() {
  const geo = new THREE.SphereGeometry(2600, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, stars: { value: 0 }, time: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float stars; uniform float time;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, top, pow(smoothstep(-0.01, 0.42, h), 0.55));
        col = mix(col, ground, smoothstep(0.0, -0.08, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6);
        col += sunColor * smoothstep(0.9993, 0.9997, sd) * 4.0;
        // horizon haze band
        col = mix(col, horizon * 1.05, exp(-abs(h) * 28.0) * 0.35);
        if (stars > 0.0 && h > 0.0) {
          vec3 g = floor(d * 420.0);
          float s = hash(g);
          float tw = 0.6 + 0.4 * sin(time * 2.0 + s * 60.0);
          col += vec3(step(0.9975, s) * tw * stars * smoothstep(0.0, 0.25, h));
          // milky band
          float band = exp(-pow((d.x * 0.6 + d.y - 0.6) * 3.0, 2.0)) * 0.05 * stars;
          col += vec3(0.55, 0.6, 0.8) * band * (0.6 + 0.4 * hash(floor(d * 140.0)));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// ------------------------------------------------------------------ FX (pooled particles, decals, tracers)
export class FX {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.particles = [];
    this.free = [];
    this.debris = [];
    this.decals = [];
    this.lights = [];
    this.tracers = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let i = 0; i < 260; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: true }));
      s.visible = false;
      this.group.add(s);
      this.free.push(s);
    }
    // flash lights are permanent so the shader program never recompiles mid-fight
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffb060', 0, 20, 2);
      this.group.add(l);
      this.lights.push({ light: l, t: 0, dur: 0.1, peak: 0 });
    }
    const debrisGeo = new THREE.BoxGeometry(0.06, 0.03, 0.14);
    this.debrisMats = { wood: assets.mat('woodDark'), stone: assets.mat('rock'), metal: assets.mat('iron'), dirt: new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 1 }) };
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(debrisGeo, this.debrisMats.wood);
      m.visible = false; m.castShadow = false;
      this.group.add(m);
      this.debris.push({ mesh: m, alive: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, ground: 0 });
    }
    const decalGeo = new THREE.CircleGeometry(0.05, 10);
    this.decalMat = new THREE.MeshBasicMaterial({ color: '#120c08', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let i = 0; i < 60; i++) {
      const d = new THREE.Mesh(decalGeo, this.decalMat);
      d.visible = false;
      this.group.add(d);
      this.decals.push(d);
    }
    this.decalIndex = 0;
    const trGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    trGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({ color: '#fff2d0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, t: 0 });
    }
  }

  sprite(tex, pos, o) {
    const s = this.free.pop();
    if (!s) return null;
    s.material.map = this.assets.tex(tex);
    s.material.color.set(o.color || '#ffffff');
    s.material.blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.opacity = o.opacity ?? 1;
    s.material.rotation = rand(0, Math.PI * 2);
    s.material.needsUpdate = true;
    s.position.copy(pos);
    s.scale.setScalar(o.size || 1);
    s.visible = true;
    this.particles.push({
      s, t: 0, life: o.life || 1, vel: (o.vel || new THREE.Vector3()).clone(), grow: o.grow ?? 1, size: o.size || 1,
      opacity: o.opacity ?? 1, gravity: o.gravity || 0, drag: o.drag ?? 0.5, spin: o.spin || rand(-1, 1), fadeIn: o.fadeIn || 0,
    });
    return s;
  }

  flashLight(pos, color = '#ffb060', peak = 30, dur = 0.08, dist = 18) {
    const l = this.lights.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    l.light.position.copy(pos); l.light.color.set(color); l.light.distance = dist;
    l.t = 0; l.dur = dur; l.peak = peak;
  }

  muzzle(pos, dir, scale = 1, light = true) {
    this.sprite('muzzle_flash', pos.clone().addScaledVector(dir, 0.15 * scale), { size: 0.9 * scale, life: 0.06, additive: true, grow: 1.3 });
    this.sprite('muzzle_flash', pos.clone().addScaledVector(dir, 0.45 * scale), { size: 0.55 * scale, life: 0.05, additive: true, grow: 1.5, color: '#ffd090' });
    for (let i = 0; i < 4; i++) {
      const v = dir.clone().multiplyScalar(rand(0.6, 2.2)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.1, 0.5), rand(-0.3, 0.3)));
      this.sprite('smoke', pos.clone().addScaledVector(dir, 0.3 * scale), { size: 0.35 * scale, life: rand(1.2, 2.2), vel: v, grow: 5, opacity: 0.35, drag: 1.2, color: '#d8d0c4' });
    }
    if (light) this.flashLight(pos, '#ffb060', 40 * scale, 0.07, 16 * scale);
  }

  impact(point, normal, surface = 'dirt', dir) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (surface === 'metal') {
      for (let i = 0; i < 10; i++) {
        const v = n.clone().multiplyScalar(rand(2, 6)).add(new THREE.Vector3(rand(-3, 3), rand(0, 3), rand(-3, 3)));
        this.sprite('spark', point, { size: 0.12, life: rand(0.2, 0.5), vel: v, gravity: 9, additive: true, grow: 0.5, drag: 0.2 });
      }
      this.flashLight(point, '#ffe0a0', 6, 0.05, 6);
    } else if (surface === 'water') {
      for (let i = 0; i < 8; i++) this.sprite('dust', point, { size: 0.2, life: 0.6, vel: new THREE.Vector3(rand(-1, 1), rand(2, 4), rand(-1, 1)), gravity: 9, color: '#cfe0ea', opacity: 0.7 });
    } else {
      const col = surface === 'wood' ? '#9a7550' : surface === 'stone' ? '#c49a76' : '#c8a274';
      for (let i = 0; i < 5; i++) {
        const v = n.clone().multiplyScalar(rand(0.5, 2.5)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.2, 1.4), rand(-0.6, 0.6)));
        this.sprite('dust', point, { size: rand(0.3, 0.6), life: rand(0.8, 1.6), vel: v, grow: 3.5, opacity: 0.8, drag: 1.5, color: col, gravity: 0.6 });
      }
      this.debrisBurst(point, n, surface === 'wood' ? 'wood' : surface === 'stone' ? 'stone' : 'dirt', 5, 3);
    }
    if (surface !== 'water' && surface !== 'dirt') this.decal(point, n);
  }

  blood(point, dir) {
    for (let i = 0; i < 4; i++) {
      const v = dir.clone().multiplyScalar(rand(1, 3)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.2, 0.8), rand(-0.6, 0.6)));
      this.sprite('hit_mist', point, { size: rand(0.25, 0.45), life: rand(0.35, 0.7), vel: v, grow: 2.6, opacity: 0.9, drag: 2, gravity: 2 });
    }
  }

  debrisBurst(point, normal, kind, count, speed) {
    let made = 0;
    for (const d of this.debris) {
      if (d.alive) continue;
      d.alive = true; d.t = 0;
      d.mesh.material = this.debrisMats[kind] || this.debrisMats.dirt;
      d.mesh.visible = true;
      d.mesh.position.copy(point);
      const s = kind === 'dirt' ? 0.6 : rand(0.6, 1.4);
      d.mesh.scale.setScalar(s);
      d.vel.copy(normal).multiplyScalar(rand(1, speed)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(1, 3.5), rand(-1.5, 1.5)));
      d.spin.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      d.ground = point.y - 3;
      if (++made >= count) break;
    }
  }

  decal(point, normal) {
    const d = this.decals[this.decalIndex++ % this.decals.length];
    d.position.copy(point).addScaledVector(normal, 0.015);
    d.lookAt(point.clone().add(normal));
    d.scale.setScalar(rand(0.8, 1.3));
    d.visible = true;
  }

  explosion(point, scale = 1) {
    this.flashLight(point, '#ffa040', 300 * scale, 0.35, 40);
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(rand(-6, 6), rand(2, 10), rand(-6, 6)).multiplyScalar(scale);
      this.sprite('muzzle_flash', point, { size: rand(1.5, 3) * scale, life: rand(0.25, 0.5), vel: v, additive: true, grow: 2.2, drag: 3, color: '#ffb050' });
    }
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3(rand(-3, 3), rand(2, 7), rand(-3, 3)).multiplyScalar(scale);
      this.sprite('smoke', point, { size: rand(1.5, 3) * scale, life: rand(2.5, 4.5), vel: v, grow: 3, opacity: 0.75, drag: 1.2, color: i < 6 ? '#3a3028' : '#7a6a5a', gravity: -0.4 });
    }
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(rand(6, 10));
      this.sprite('dust', point.clone().setY(point.y + 0.2), { size: 1.4 * scale, life: 1.6, vel: v, grow: 4, opacity: 0.7, drag: 2.5, color: '#c8a274' });
    }
    this.debrisBurst(point, new THREE.Vector3(0, 1, 0), 'wood', 16, 9);
  }

  tracer(from, to) {
    const tr = this.tracers.reduce((a, b) => (a.t > b.t ? a : b));
    tr.t = 0;
    const m = tr.mesh;
    m.visible = true;
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    m.material.opacity = 0.5;
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.s.visible = false; this.free.push(p.s); this.particles.splice(i, 1); continue; }
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.vel.y -= p.gravity * dt;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size * (1 + (p.grow - 1) * k));
      const fin = p.fadeIn ? Math.min(1, p.t / p.fadeIn) : 1;
      p.s.material.opacity = p.opacity * (1 - k * k) * fin;
      p.s.material.rotation += p.spin * dt;
    }
    for (const d of this.debris) {
      if (!d.alive) continue;
      d.t += dt;
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.t > 2.5 || d.mesh.position.y < d.ground) { d.alive = false; d.mesh.visible = false; }
    }
    for (const l of this.lights) {
      l.t += dt;
      l.light.intensity = l.t < l.dur ? l.peak * (1 - l.t / l.dur) : 0;
    }
    for (const tr of this.tracers) {
      tr.t += dt;
      if (tr.mesh.visible) {
        tr.mesh.material.opacity = Math.max(0, 0.5 - tr.t * 1.4);
        if (tr.mesh.material.opacity <= 0) tr.mesh.visible = false;
      }
    }
  }

  clear() {
    for (const p of this.particles) { p.s.visible = false; this.free.push(p.s); }
    this.particles.length = 0;
    for (const d of this.debris) { d.alive = false; d.mesh.visible = false; }
    for (const d of this.decals) d.visible = false;
    for (const t of this.tracers) t.mesh.visible = false;
    for (const l of this.lights) { l.t = 99; l.light.intensity = 0; }
  }
}

// ------------------------------------------------------------------ world
export class World {
  constructor(game) {
    this.game = game;
    this.assets = game.assets;
    this.scene = new THREE.Scene();
    this.colliders = [];
    this.spawns = {};
    this.explosives = [];
    this.animated = [];
    this.lampLights = [];
    this.lampMeshes = [];
    this.windowMats = [];
    this.static = new THREE.Group();
    this.scene.add(this.static);
    this.time = 0;
    this.wind = new THREE.Vector2(0, 0);

    this.sky = makeSky();
    this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#886644', 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -190; sc.right = 190; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 900;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.fog = new THREE.Fog('#e6cda6', 150, 1300);
    this.fx = new FX(this.scene, this.assets);
    this.vantage = new THREE.Vector3(0, 19.6, 0);
    this.layout = null;
  }

  setShadowQuality(q) {
    const size = { low: 0, medium: 2048, high: 4096, ultra: 4096 }[q] ?? 2048;
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  // -------------------------------------------------------------- build
  build(layout, timeName, seed = 1) {
    this.clear();
    this.layout = layout;
    this.timeName = timeName;
    this.preset = TIME_PRESETS[timeName];
    this.rng = seededRandom(seed * 7919 + layout.length);
    this.terrace = layout === 'town' || layout === 'ridge' ? { z: -128, h: 6 } : { z: -112, h: 4 };
    this.applyTime(this.preset);
    this.buildTerrain();
    this.buildDistant();
    this.buildVantage();
    if (layout === 'town') this.buildTown(false);
    else if (layout === 'junction') this.buildJunction();
    else this.buildTown(true);
    this.buildRidge();
    this.scatterNature();
    this.buildAmbient();
    this.applyLamps(this.preset);
    this.optimizeStatic();
  }

  // Batch every static mesh by material into a single draw call. The originals stay in the
  // graph (hidden) so bullet raycasts keep their tight per-object bounds.
  optimizeStatic() {
    this.static.updateMatrixWorld(true);
    const buckets = new Map();
    const dynamic = (o) => { for (let p = o; p && p !== this.static; p = p.parent) if (p.userData.dynamic) return true; return false; };
    this.static.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible || o === this.ground) return;
      const m = o.material;
      if (m.transparent || m.isShaderMaterial || m.fog === false || o.renderOrder !== 0 || dynamic(o)) return;
      const key = `${m.uuid}|${o.castShadow}|${o.receiveShadow}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    });
    this.batches = [];
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const mesh = new THREE.Mesh(mergeMeshes(list), list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.userData.batch = true;
      this.static.add(mesh);
      this.batches.push(mesh);
      for (const o of list) o.visible = false;
    }
  }

  clear() {
    this.fx.clear();
    // free per-map GPU resources (shared/cached geometry + materials live in Assets)
    this.static.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      if (o.geometry && !o.geometry.userData.cached) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && !m.userData.shared) m.dispose();
    });
    this.scene.remove(this.static);
    this.static = new THREE.Group();
    this.scene.add(this.static);
    this.colliders = [];
    this.spawns = { window: [], roof: [], balcony: [], door: [], street: [], sniper: [], hostage: [], exit: [], rider: [], runnerStart: [], civilianPath: [] };
    this.explosives = [];
    this.animated = [];
    this.lampLights = [];
    this.lampMeshes = [];
    this.windowMats = [];
    this.tumbleweeds = [];
    this.birds = [];
    this.smokeEmitters = [];
    this.train = null;
    this.buildings = [];
  }

  applyTime(p) {
    const u = this.sky.material.uniforms;
    u.top.value.set(p.skyTop); u.horizon.value.set(p.skyHorizon); u.ground.value.set(p.ground);
    const sd = new THREE.Vector3(...p.sunDir).normalize();
    u.sunDir.value.copy(sd); u.sunColor.value.set(p.sunDisk); u.stars.value = p.stars;
    this.sun.color.set(p.sunColor); this.sun.intensity = p.sunIntensity;
    this.sun.position.copy(sd).multiplyScalar(400).add(new THREE.Vector3(0, 0, -110));
    this.sun.target.position.set(0, 0, -110);
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.scene.fog.color.set(p.fog); this.scene.fog.near = p.fogNear; this.scene.fog.far = p.fogFar;
    this.game.renderer.toneMappingExposure = p.exposure;
    const lamp = this.assets.mat('glassLamp');
    lamp.emissiveIntensity = p.lamps ? 2.5 : 0;
    this.buildEnvironment(p);
  }

  // Image-based lighting: prefilter the procedural sky into a PMREM so PBR metals and
  // wood pick up sky reflections and soft ambient light.
  buildEnvironment(p) {
    const r = this.game.renderer;
    this.pmrem ||= new THREE.PMREMGenerator(r);
    if (!this.envScene) {
      this.envScene = new THREE.Scene();
      this.envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.sky.material);
      this.envScene.add(this.envSky);
      const groundMat = new THREE.MeshBasicMaterial({ color: '#8a6a4a', side: THREE.DoubleSide });
      this.envGround = new THREE.Mesh(new THREE.CircleGeometry(48, 24), groundMat);
      this.envGround.rotation.x = -Math.PI / 2;
      this.envGround.position.y = -2;
      this.envScene.add(this.envGround);
    }
    this.envGround.material.color.set(p.ground).multiplyScalar(this.timeName === 'night' ? 0.4 : 0.9);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.timeName === 'night' ? 0.35 : 0.55;
    if (old) old.dispose();
  }

  // -------------------------------------------------------------- terrain
  heightAt(x, z) {
    // vantage hill the player stands on
    let h = smoothstep(-48, -14, z) * 8 + smoothstep(-14, 30, z) * 2;
    h *= 1 - smoothstep(70, 180, Math.abs(x)) * 0.4;
    // raised terrace behind the main street
    const t = this.terrace;
    h += smoothstep(t.z + 6, t.z - 6, z) * t.h;
    // outer dunes / foothills
    const r = Math.hypot(x * 0.8, z + 120);
    const wild = smoothstep(190, 320, r);
    h += wild * (Math.sin(x * 0.011) * 9 + Math.cos(z * 0.013 + x * 0.004) * 7 + Math.sin(x * 0.031 + z * 0.02) * 3 + 6);
    // gentle ground undulation in town
    h += Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.15;
    return h;
  }

  buildTerrain() {
    const size = 2600, seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color('#ffffff');
    const tint = new THREE.Color(this.timeName === 'night' ? '#9aa2c0' : this.timeName === 'sunset' ? '#ffd2b0' : '#ffffff');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i) - 120;
      pos.setZ(i, z);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const shade = 0.82 + 0.18 * Math.sin(x * 0.05 + z * 0.03) * Math.cos(z * 0.021);
      const c = base.clone().multiplyScalar(shade).multiply(tint);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 9, uv.getY(i) * size / 9);
    const mat = new THREE.MeshStandardMaterial({ map: this.assets.tex('sand'), vertexColors: true, roughness: 1, color: '#ffffff' });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.userData.surface = 'dirt';
    ground.name = 'ground';
    this.static.add(ground);
    this.colliders.push(ground);
    this.ground = ground;
  }

  buildDistant() {
    const p = this.preset;
    const mk = (tex, radius, height, color, yOff, repeat) => {
      const t = this.assets.tex(tex).clone();
      t.wrapS = THREE.RepeatWrapping; t.repeat.set(repeat, 1); t.needsUpdate = true;
      const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true);
      const m = new THREE.MeshBasicMaterial({ map: t, color, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = height / 2 + yOff;
      mesh.renderOrder = -5;
      this.static.add(mesh);
      return mesh;
    };
    const far = new THREE.Color(p.mesaFar).lerp(new THREE.Color(p.skyHorizon), 0.35);
    mk('mesa_layer1', 2100, 300, far, -20, 3);
    mk('mesa_layer0', 1700, 330, new THREE.Color(p.mesaNear).lerp(new THREE.Color(p.fog), 0.25), -25, 2.5);
    // cloud layer
    const ct = this.assets.tex('clouds').clone();
    ct.repeat.set(3, 3); ct.needsUpdate = true;
    const cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: p.cloud, fog: false, depthWrite: false, color: this.timeName === 'sunset' ? '#ffc8a0' : this.timeName === 'night' ? '#3a4466' : '#ffffff' });
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), cloudMat);
    clouds.rotation.x = Math.PI / 2;
    clouds.position.y = 420;
    clouds.renderOrder = -6;
    this.static.add(clouds);
    this.animated.push((dt) => { ct.offset.x += dt * 0.002; ct.offset.y += dt * 0.0007; });
    // 3D mesas at mid distance
    const rockMat = this.assets.surface('rock', 12, this.timeName === 'night' ? '#7a8098' : '#ffffff', { roughness: 1 });
    const spots = [[-420, -620, 90, 110], [260, -700, 120, 140], [620, -480, 70, 90], [-720, -380, 80, 70], [40, -980, 160, 170], [-260, -900, 100, 120], [880, -820, 130, 150]];
    for (const [x, z, r, h] of spots) this.static.add(this.mesa(x, z, r, h, rockMat));
  }

  mesa(x, z, r, h, mat) {
    const geo = new THREE.CylinderGeometry(r * 0.8, r * 1.25, h, 28, 8);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const ang = Math.atan2(v.z, v.x);
      const n = Math.sin(ang * 5 + x) * 0.08 + Math.sin(ang * 13 + z) * 0.04 + Math.sin(v.y * 0.2 + ang * 3) * 0.03;
      const k = 1 + n;
      v.x *= k; v.z *= k;
      if (v.y > h / 2 - 1) v.y += Math.sin(ang * 7) * 1.5;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * h / 14);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, h / 2 + this.heightAt(x, z) - 4, z);
    m.receiveShadow = true;
    return m;
  }

  // Lookout tower the player snipes from + foreground framing
  buildVantage() {
    const gy = this.heightAt(0, 0);
    const top = this.vantage.y - 1.55;
    const g = new THREE.Group();
    const wood = this.assets.mat('woodDark');
    const legH = top - gy + 0.5;
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const leg = new THREE.Mesh(this.assets.boxGeo(0.28, legH, 0.28, 2), wood);
      leg.position.set(x, gy + legH / 2 - 0.5, z);
      leg.castShadow = true;
      g.add(leg);
    }
    for (let y = gy + 2.5; y < top - 1; y += 3.2) {
      for (const [ax, az, ry] of [[0, -1.6, 0], [0, 1.6, 0], [-1.6, 0, 90], [1.6, 0, 90]]) {
        const br = new THREE.Mesh(this.assets.boxGeo(4.4, 0.14, 0.12, 2), wood);
        br.position.set(ax, y, az); br.rotation.set(0, ry * DEG, ry ? 0 : 0.6);
        if (ry) br.rotation.set(0.6, ry * DEG, 0);
        g.add(br);
      }
    }
    const deck = new THREE.Mesh(this.assets.boxGeo(4.4, 0.2, 4.4, 2), this.assets.mat('wood'));
    deck.position.set(0, top, 0);
    deck.receiveShadow = true;
    g.add(deck);
    // railing in front of the shooter (visible at the bottom of the screen)
    const railMat = this.assets.mat('woodGrey');
    const rail = new THREE.Mesh(this.assets.boxGeo(4.4, 0.14, 0.14, 2), railMat);
    rail.position.set(0, top + 0.62, -2.15);
    g.add(rail);
    const rail2 = rail.clone(); rail2.position.y = top + 0.3; g.add(rail2);
    for (const x of [-2.1, -0.7, 0.7, 2.1]) {
      const post = new THREE.Mesh(this.assets.boxGeo(0.14, 0.7, 0.14, 2), railMat);
      post.position.set(x, top + 0.35, -2.15);
      g.add(post);
    }
    // sandbags + ammo crate on the deck
    const bagMat = new THREE.MeshStandardMaterial({ color: '#a89070', map: this.assets.tex('cloth'), roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 4, 8), bagMat);
      bag.rotation.z = Math.PI / 2;
      bag.position.set(-1.9 + i * 0.5, top + 0.2, -1.75);
      bag.scale.set(1, 1, 0.8);
      g.add(bag);
    }
    const crate = this.assets.build('crate');
    crate.scale.setScalar(0.6);
    crate.position.set(1.4, top + 0.1, -1.2);
    g.add(crate);
    // canopy
    const roof = new THREE.Mesh(this.assets.boxGeo(5.2, 0.12, 5.2, 2), this.assets.mat('tin'));
    roof.position.set(0, top + 3.4, 0.2);
    roof.rotation.x = -0.08;
    roof.castShadow = true;
    g.add(roof);
    for (const [x, z] of [[-2.1, 2.1], [2.1, 2.1]]) {
      const post = new THREE.Mesh(this.assets.boxGeo(0.14, 3.4, 0.14, 2), wood);
      post.position.set(x, top + 1.7, z);
      g.add(post);
    }
    g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
    this.static.add(g);
    this.vantageGroup = g;
  }

  // -------------------------------------------------------------- buildings
  /**
   * spec: { x, z, w, d, stories, style, color, trim, sign, falseFront, stepped, porch, balcony, yaw, baseY, lit, windows }
   * Facade faces local +Z. yaw rotates the building around Y.
   */
  building(spec) {
    const A = this.assets;
    const g = new THREE.Group();
    const w = spec.w, d = spec.d || 10, storyH = 3.3, stories = spec.stories || 1;
    const H = stories * storyH;
    const ff = spec.falseFront ?? 1.6;
    const topH = H + ff;
    const styleTex = { wood: 'wood_planks', adobe: 'adobe', brick: 'brick' }[spec.style || 'wood'];
    const tile = spec.style === 'brick' ? 3 : spec.style === 'adobe' ? 4 : 2.4;
    const wallMat = A.surface(styleTex, tile, spec.color || '#d8b896', { bump: 0.4 });
    const trimMat = A.surface('wood_planks', 2, spec.trim || '#5a3c26');
    const surface = spec.style === 'wood' || !spec.style ? 'wood' : 'stone';

    // --- front wall with real openings
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    const stepped = spec.stepped && ff > 1;
    const shoulder = H + ff * 0.45;
    if (stepped) {
      shape.lineTo(w / 2, shoulder); shape.lineTo(w * 0.28, shoulder); shape.lineTo(w * 0.28, topH);
      shape.lineTo(-w * 0.28, topH); shape.lineTo(-w * 0.28, shoulder); shape.lineTo(-w / 2, shoulder);
    } else if (spec.gable) {
      shape.lineTo(w / 2, H + 0.4); shape.lineTo(0, topH + 1.2); shape.lineTo(-w / 2, H + 0.4);
    } else {
      shape.lineTo(w / 2, topH); shape.lineTo(-w / 2, topH);
    }
    shape.lineTo(-w / 2, 0);
    const topAt = (x) => (stepped ? (Math.abs(x) < w * 0.28 ? topH : shoulder) : spec.gable ? H + 0.4 : topH);

    const openings = [];
    const winW = 1.05, winH = 1.45;
    const perFloor = spec.windows ?? Math.max(1, Math.floor((w - 2.5) / 2.6));
    for (let f = 0; f < stories; f++) {
      const fy = f * storyH;
      const slots = [];
      const hasDoor = f === 0 && spec.door !== false;
      const balconyDoor = f === 1 && spec.balcony;
      const n = perFloor + (hasDoor || balconyDoor ? 1 : 0);
      for (let i = 0; i < n; i++) slots.push(-w / 2 + (w / n) * (i + 0.5));
      const mid = Math.floor(n / 2);
      slots.forEach((x, i) => {
        if ((hasDoor || balconyDoor) && i === mid) {
          const dw = hasDoor ? (spec.sign === 'saloon' ? 1.8 : 1.4) : 1.1;
          openings.push({ kind: hasDoor ? 'door' : 'bdoor', x: 0, y: fy + 0.05, w: dw, h: hasDoor ? 2.5 : 2.3, floor: f });
        } else {
          openings.push({ kind: 'window', x, y: fy + 0.95, w: winW, h: winH, floor: f });
        }
      });
    }
    for (const o of openings) {
      const hole = new THREE.Path();
      hole.moveTo(o.x - o.w / 2, o.y); hole.lineTo(o.x - o.w / 2, o.y + o.h); hole.lineTo(o.x + o.w / 2, o.y + o.h); hole.lineTo(o.x + o.w / 2, o.y); hole.lineTo(o.x - o.w / 2, o.y);
      shape.holes.push(hole);
    }
    const frontGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
    const uv = frontGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
    const front = new THREE.Mesh(frontGeo, wallMat);
    front.position.z = d / 2 - 0.22;
    front.castShadow = front.receiveShadow = true;
    front.userData.surface = surface;
    g.add(front);
    this.colliders.push(front);

    // --- body: side + back walls, floors, roof
    const sideGeo = A.boxGeo(0.22, H + 0.2, d - 0.22, tile);
    for (const sx of [-w / 2 + 0.11, w / 2 - 0.11]) {
      const side = new THREE.Mesh(sideGeo, wallMat);
      side.position.set(sx, (H + 0.2) / 2, -0.11);
      side.castShadow = side.receiveShadow = true;
      side.userData.surface = surface;
      g.add(side);
      this.colliders.push(side);
    }
    const back = new THREE.Mesh(A.boxGeo(w, H + 0.2, 0.22, tile), wallMat);
    back.position.set(0, (H + 0.2) / 2, -d / 2 + 0.11);
    back.castShadow = true;
    g.add(back);
    const interiorMat = INTERIOR_DARK;
    for (let f = 0; f < stories; f++) {
      const floor = new THREE.Mesh(A.boxGeo(w - 0.3, 0.16, d - 0.4, 2), A.mat('woodDark'));
      floor.position.set(0, f * storyH + 0.02, 0);
      floor.receiveShadow = true;
      floor.userData.surface = 'wood';
      g.add(floor);
      this.colliders.push(floor);
      // interior back-drop (dark by day, warm when lit at night)
      const lit = spec.lit && (f === 0 || this.rng() < 0.7);
      const im = lit ? pick(INTERIOR_LIT) : interiorMat;
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, storyH), im);
      inner.position.set(0, f * storyH + storyH / 2, d / 2 - 2.3);
      g.add(inner);
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, 2.2), interiorMat);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(0, f * storyH + storyH - 0.05, d / 2 - 1.2);
      g.add(ceil);
      for (const sx of [-w / 2 + 0.25, w / 2 - 0.25]) {
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(2.3, storyH), interiorMat);
        wall.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
        wall.position.set(sx, f * storyH + storyH / 2, d / 2 - 1.15);
        g.add(wall);
      }
    }
    // roof deck behind the false front, then a pitched roof
    const deck = new THREE.Mesh(A.boxGeo(w - 0.2, 0.16, 2.2, 2), A.mat('woodDark'));
    deck.position.set(0, H + 0.02, d / 2 - 1.3);
    deck.receiveShadow = true;
    g.add(deck);
    this.colliders.push(deck);
    const roofMat = spec.style === 'adobe' ? A.surface('adobe', 4, spec.color || '#d8b896') : chance(0.5) ? A.surface('tin_roof', 3, '#ffffff', { metalness: 0.3, roughness: 0.6 }) : A.surface('wood_planks', 2, '#8a6a4e');
    if (spec.style === 'adobe') {
      const flat = new THREE.Mesh(A.boxGeo(w, 0.3, d - 2.4, 4), roofMat);
      flat.position.set(0, H + 0.1, -1.2);
      flat.castShadow = true;
      g.add(flat);
      // vigas (protruding beams)
      for (let x = -w / 2 + 0.8; x < w / 2; x += 1.4) {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 6), A.mat('woodDark'));
        v.rotation.x = Math.PI / 2;
        v.position.set(x, H - 0.3, d / 2 + 0.25);
        g.add(v);
      }
    } else {
      const pitch = 0.32;
      const span = (w / 2) / Math.cos(pitch);
      for (const s of [-1, 1]) {
        const r = new THREE.Mesh(A.boxGeo(span + 0.3, 0.12, d - 2.2, 3), roofMat);
        r.position.set(s * w / 4, H + Math.tan(pitch) * w / 4 + 0.1, -1.1);
        r.rotation.z = -s * pitch;
        r.castShadow = r.receiveShadow = true;
        r.userData.surface = 'metal';
        g.add(r);
        this.colliders.push(r);
      }
    }
    // chimney
    if (chance(0.5)) {
      const ch = new THREE.Mesh(A.boxGeo(0.6, 2.2, 0.6, 2), A.surface('brick', 3, '#ffffff'));
      const cx = rand(-w / 3, w / 3), cz = -d / 2 + 1.5;
      ch.position.set(cx, H + 1.6, cz);
      ch.castShadow = true;
      g.add(ch);
      this.smokeEmitters.push({ local: new THREE.Vector3(cx, H + 2.8, cz), group: g, t: rand(0, 1) });
    }

    // --- cornice, trim and openings dressing
    const cornice = new THREE.Mesh(A.boxGeo(stepped ? w * 0.56 + 0.3 : w + 0.3, 0.28, 0.4, 2), trimMat);
    cornice.position.set(0, (stepped ? topH : spec.gable ? H + 0.4 : topH) - 0.1, d / 2 + 0.1);
    cornice.castShadow = true;
    g.add(cornice);
    if (stepped) {
      for (const s of [-1, 1]) {
        const c2 = new THREE.Mesh(A.boxGeo(w * 0.22 + 0.15, 0.22, 0.34, 2), trimMat);
        c2.position.set(s * (w * 0.39 + 0.07), shoulder - 0.08, d / 2 + 0.08);
        g.add(c2);
      }
    }
    for (const sx of [-w / 2, w / 2]) {
      const pil = new THREE.Mesh(A.boxGeo(0.3, topAt(sx * 0.99), 0.32, 2), trimMat);
      pil.position.set(sx, topAt(sx * 0.99) / 2, d / 2 + 0.06);
      pil.castShadow = true;
      g.add(pil);
    }
    if (stories > 1) {
      const band = new THREE.Mesh(A.boxGeo(w, 0.22, 0.3, 2), trimMat);
      band.position.set(0, storyH, d / 2 + 0.06);
      g.add(band);
    }
    const winTex = this.assets.tex(spec.lit ? 'window_lit' : 'window_dark');
    for (const o of openings) {
      const fr = 0.09;
      const frameParts = [[o.w + fr * 2, fr, 0, o.h + fr / 2], [o.w + fr * 2, fr, 0, -fr / 2], [fr, o.h, -o.w / 2 - fr / 2, o.h / 2], [fr, o.h, o.w / 2 + fr / 2, o.h / 2]];
      for (const [fw, fh, fx, fy] of frameParts) {
        const m = new THREE.Mesh(A.boxGeo(fw, fh, 0.3, 2), trimMat);
        m.position.set(o.x + fx, o.y + fy, d / 2 + 0.02);
        g.add(m);
      }
      if (o.kind === 'window') {
        const sill = new THREE.Mesh(A.boxGeo(o.w + 0.35, 0.08, 0.38, 2), trimMat);
        sill.position.set(o.x, o.y - 0.06, d / 2 + 0.1);
        g.add(sill);
        // shutters, swung open
        if (spec.shutters) {
          for (const s of [-1, 1]) {
            const sh = new THREE.Mesh(A.boxGeo(o.w / 2, o.h, 0.05, 1), A.surface('wood_planks', 1, spec.shutters));
            sh.position.set(o.x + s * (o.w / 2 + o.w / 4 + 0.08), o.y + o.h / 2, d / 2 + 0.06);
            g.add(sh);
          }
        }
        // curtain hint
        const cur = new THREE.Mesh(new THREE.PlaneGeometry(0.28, o.h * 0.9), pick(CURTAINS));
        cur.position.set(o.x + o.w / 2 - 0.16, o.y + o.h * 0.47, d / 2 - 0.45);
        g.add(cur);
        const spawn = this.addSpawn('window', g, spec, new THREE.Vector3(o.x, o.floor * storyH + 0.1, d / 2 - 0.62), new THREE.Vector3(o.x, o.floor * storyH + 0.1, d / 2 - 1.55));
        spawn.windowY = o.y;
      } else if (o.kind === 'door') {
        if (spec.sign === 'saloon') {
          for (const s of [-1, 1]) {
            const pivot = new THREE.Group();
            pivot.position.set(o.x + s * o.w / 2, o.y + 0.5, d / 2 - 0.1);
            const leaf = new THREE.Mesh(A.boxGeo(o.w / 2 - 0.05, 1.1, 0.05, 1), A.surface('wood_planks', 1, '#8a5a34'));
            leaf.position.set(-s * (o.w / 4), 0.55, 0);
            pivot.add(leaf);
            pivot.userData.dynamic = true;
            g.add(pivot);
            this.animated.push((dt, t) => { pivot.rotation.y = s * Math.sin(t * 1.3 + s) * 0.08; });
          }
        }
        this.addSpawn('door', g, spec, new THREE.Vector3(0, 0.1, d / 2 + 0.6), new THREE.Vector3(0, 0.1, d / 2 - 1.6));
      } else if (o.kind === 'bdoor') {
        const sp = this.addSpawn('balcony', g, spec, new THREE.Vector3(0, storyH + 0.12, d / 2 + 0.85), new THREE.Vector3(0, storyH + 0.12, d / 2 - 1.5));
        sp.walk = [new THREE.Vector3(rand(-w / 3, -1), storyH + 0.12, d / 2 + 0.9), new THREE.Vector3(rand(1, w / 3), storyH + 0.12, d / 2 + 0.9)];
      }
    }
    // glass panes in windows next to door (storefront) for flavour
    void winTex;

    // --- porch / boardwalk + awning or balcony
    if (spec.porch !== false) {
      const pd = 2.6;
      const walk = new THREE.Mesh(A.boxGeo(w + 0.4, 0.3, pd, 2.4), A.surface('wood_planks', 2.4, '#a88866'));
      walk.position.set(0, 0.15, d / 2 + pd / 2);
      walk.receiveShadow = walk.castShadow = true;
      walk.userData.surface = 'wood';
      g.add(walk);
      this.colliders.push(walk);
      const postsN = Math.max(2, Math.round(w / 3.2) + 1);
      const postH = spec.balcony ? storyH : storyH - 0.4;
      for (let i = 0; i < postsN; i++) {
        const px = -w / 2 + 0.2 + (w - 0.4) * (i / (postsN - 1));
        const post = new THREE.Mesh(A.boxGeo(0.18, postH, 0.18, 2), trimMat);
        post.position.set(px, postH / 2 + 0.3, d / 2 + pd - 0.15);
        post.castShadow = true;
        post.userData.surface = 'wood';
        g.add(post);
        this.colliders.push(post);
        if (this.preset.lamps && i % 2 === 1 && this.lampLights.length < 7 && chance(0.6)) {
          const lan = A.build('lantern_hook');
          lan.position.set(px, postH - 0.1, d / 2 + pd - 0.4);
          g.add(lan);
          this.registerLamp(lan, g);
        }
      }
      if (spec.balcony) {
        const bal = new THREE.Mesh(A.boxGeo(w + 0.4, 0.2, pd, 2.4), A.surface('wood_planks', 2.4, '#8a6a4e'));
        bal.position.set(0, storyH + 0.02, d / 2 + pd / 2);
        bal.castShadow = bal.receiveShadow = true;
        bal.userData.surface = 'wood';
        g.add(bal);
        this.colliders.push(bal);
        const rail = new THREE.Mesh(A.boxGeo(w + 0.4, 0.1, 0.1, 2), trimMat);
        rail.position.set(0, storyH + 1.05, d / 2 + pd - 0.1);
        g.add(rail);
        for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.45) {
          const bal2 = new THREE.Mesh(A.boxGeo(0.05, 0.85, 0.05, 1), trimMat);
          bal2.position.set(x, storyH + 0.55, d / 2 + pd - 0.1);
          g.add(bal2);
        }
        const awn = new THREE.Mesh(A.boxGeo(w + 0.6, 0.1, pd + 0.3, 3), A.surface('tin_roof', 3, '#ffffff', { metalness: 0.3, roughness: 0.6 }));
        awn.position.set(0, storyH * 2 - 0.25, d / 2 + pd / 2);
        awn.rotation.x = 0.12;
        awn.castShadow = true;
        if (stories > 1) g.add(awn);
      } else {
        const awn = new THREE.Mesh(A.boxGeo(w + 0.6, 0.1, pd + 0.4, 3), spec.style === 'adobe' ? A.surface('wood_planks', 2, '#7a5a3e') : A.surface('tin_roof', 3, '#ffffff', { metalness: 0.3, roughness: 0.6 }));
        awn.position.set(0, postH + 0.38, d / 2 + pd / 2);
        awn.rotation.x = 0.14;
        awn.castShadow = true;
        awn.userData.surface = 'metal';
        g.add(awn);
        this.colliders.push(awn);
      }
    }

    // --- sign
    if (spec.sign) {
      const sw = Math.min(w * 0.72, 8), sh = sw / 4;
      const signMat = new THREE.MeshStandardMaterial({ map: A.tex('sign_' + spec.sign), roughness: 0.8 });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.08), [trimMat, trimMat, trimMat, trimMat, signMat, trimMat]);
      const sy = stories > 1 ? (stepped ? shoulder + (topH - shoulder) / 2 - 0.1 : H + ff / 2 - 0.05) : H + ff / 2 - 0.05;
      sign.position.set(0, stories > 1 && ff < 1.2 ? storyH * 2 - 0.9 : Math.max(sy, H - 0.6), d / 2 + 0.17);
      if (spec.gable) sign.position.y = H - 0.7;
      sign.castShadow = true;
      g.add(sign);
    }

    // --- roof spawns (behind the parapet)
    if (ff >= 1.1 && !spec.gable) {
      const slots = stepped ? [-w * 0.38, w * 0.38, 0] : [-w / 4, w / 4];
      for (const sx of slots) {
        const top = topAt(sx);
        const sp = this.addSpawn('roof', g, spec, new THREE.Vector3(sx, top - 1.12, d / 2 - 0.65), new THREE.Vector3(sx, top - 2.05, d / 2 - 0.65));
        sp.parapet = top;
      }
    }

    g.position.set(spec.x, spec.baseY ?? this.heightAt(spec.x, spec.z), spec.z);
    g.rotation.y = spec.yaw || 0;
    this.static.add(g);
    g.updateMatrixWorld(true);
    // convert spawn points to world space now that the transform is final; facades that
    // face away from the sniper's tower can't be seen, so their spawns are discarded
    const facing = new THREE.Vector3(Math.sin(spec.yaw || 0), 0, Math.cos(spec.yaw || 0));
    for (const s of g.userData.spawns || []) {
      s.pos.applyMatrix4(g.matrixWorld);
      s.hidden.applyMatrix4(g.matrixWorld);
      if (s.walk) s.walk.forEach((p) => p.applyMatrix4(g.matrixWorld));
      s.yaw = (spec.yaw || 0);
      const toPlayer = this.vantage.clone().sub(s.pos).setY(0).normalize();
      if (facing.dot(toPlayer) < 0.3) {
        const list = this.spawns[s.type];
        list.splice(list.indexOf(s), 1);
      }
    }
    this.buildings.push({ group: g, spec });
    return g;
  }

  addSpawn(type, group, spec, pos, hidden) {
    const s = { type, pos, hidden, building: spec.sign || spec.name || 'building', occupied: false, yaw: spec.yaw || 0 };
    (group.userData.spawns ||= []).push(s);
    this.spawns[type].push(s);
    return s;
  }

  registerLamp(obj, parent) {
    const def = obj.userData.def?.light;
    if (!def) return;
    const l = new THREE.PointLight(def.color, 0, def.distance, 2);
    l.position.set(...def.p);
    obj.add(l);
    this.lampLights.push({ light: l, base: def.intensity, phase: rand(0, 10) });
    void parent;
  }

  applyLamps(p) {
    for (const l of this.lampLights) l.light.intensity = p.lamps ? l.base * (this.timeName === 'night' ? 1.4 : 0.7) : 0;
  }

  placeProp(name, x, z, yaw = 0, opts = {}) {
    const m = this.assets.build(name);
    const y = opts.y ?? this.heightAt(x, z);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    if (opts.scale) m.scale.setScalar(opts.scale);
    m.traverse((o) => {
      if (o.isMesh) {
        const matName = [...this.assets.materials.entries()].find(([, v]) => v === o.material)?.[0];
        o.userData.surface = SURFACE_BY_MAT[matName] || (matName && matName.startsWith('wood') ? 'wood' : matName === 'barrelWood' || matName === 'redBarrel' ? 'wood' : 'dirt');
      }
    });
    this.static.add(m);
    if (opts.collide !== false) this.colliders.push(m);
    const def = m.userData.def;
    if (m.userData.parts.rotor) {
      const rotor = m.userData.parts.rotor;
      rotor.userData.dynamic = true;
      const speed = rand(0.6, 1.4);
      this.animated.push((dt) => { rotor.rotation.z -= dt * speed * (1 + Math.abs(this.wind.x) * 0.3); });
    }
    if (def?.explosive) {
      m.userData.dynamic = true;
      m.userData.explosive = true;
      this.explosives.push({ obj: m, alive: true });
    }
    if (def?.light && this.preset.lamps) this.registerLamp(m, this.static);
    if (opts.cover) {
      // cover point on the far side of the prop as seen from the vantage
      const away = new THREE.Vector3(x - this.vantage.x, 0, z - this.vantage.z).normalize();
      const dist = opts.cover;
      const cp = new THREE.Vector3(x, y, z).addScaledVector(away, dist);
      cp.y = this.heightAt(cp.x, cp.z);
      this.spawns.street.push({ type: 'street', pos: cp, hidden: cp.clone(), occupied: false, yaw: Math.atan2(-away.x, -away.z), coverHeight: opts.coverHeight || 1, prop: name });
    }
    return m;
  }

  // -------------------------------------------------------------- layouts
  buildTown(night) {
    const zF = -86; // facade line of the main row
    const row = night ? [
      { w: 10, stories: 1, style: 'wood', color: '#9a8a7a', sign: 'livery', falseFront: 1.9, stepped: true, gable: false },
      { w: 9, stories: 2, style: 'wood', color: '#c8b8a0', sign: 'barber', falseFront: 1.4, shutters: '#5a6a7a' },
      { w: 14, stories: 2, style: 'wood', color: '#b8784e', sign: 'saloon', falseFront: 1.8, stepped: true, balcony: true },
      { w: 9, stories: 1, style: 'adobe', color: '#d8b48c', sign: 'sheriff', falseFront: 1.3 },
      { w: 11, stories: 2, style: 'brick', color: '#ffffff', sign: 'assay', falseFront: 1.2 },
      { w: 13, stories: 2, style: 'wood', color: '#7a8a96', sign: 'hotel', falseFront: 1.6, balcony: true, shutters: '#3a2a1a' },
      { w: 8, stories: 1, style: 'wood', color: '#6a6a6a', sign: 'undertaker', falseFront: 1.8, stepped: true },
      { w: 10, stories: 2, style: 'wood', color: '#c89a6a', sign: 'telegraph', falseFront: 1.5, balcony: true },
    ] : [
      { w: 11, stories: 1, style: 'wood', color: '#a07a56', sign: 'livery', gable: true, falseFront: 0.5 },
      { w: 9, stories: 1, style: 'wood', color: '#8a7a6a', sign: 'blacksmith', falseFront: 1.6, stepped: true },
      { w: 11, stories: 2, style: 'wood', color: '#d8c4a0', sign: 'store', falseFront: 1.5, balcony: true, shutters: '#4a6a5a' },
      { w: 14, stories: 2, style: 'wood', color: '#c08050', sign: 'saloon', falseFront: 2.0, stepped: true, balcony: true },
      { w: 11, stories: 2, style: 'brick', color: '#ffffff', sign: 'bank', falseFront: 1.3 },
      { w: 14, stories: 2, style: 'wood', color: '#9ab0b8', sign: 'hotel', falseFront: 1.6, balcony: true, shutters: '#6a2a24' },
      { w: 9, stories: 1, style: 'adobe', color: '#e0bc94', sign: 'sheriff', falseFront: 1.3 },
      { w: 8, stories: 1, style: 'wood', color: '#6e6a66', sign: 'undertaker', falseFront: 1.8, stepped: true },
      { w: 9, stories: 2, style: 'wood', color: '#e6d6b8', sign: 'assay', falseFront: 1.2 },
    ];
    const gap = 2.6;
    const total = row.reduce((a, b) => a + b.w, 0) + gap * (row.length - 1);
    let x = -total / 2;
    for (const b of row) {
      const cx = x + b.w / 2;
      const d = 11;
      this.building({ ...b, x: cx, z: zF - d / 2, d, lit: night || (this.preset.windowsLit > 0 && chance(this.preset.windowsLit)) });
      x += b.w + gap;
    }
    const half = total / 2;
    // angled end buildings that frame the street
    this.building({ x: -half - 12, z: -74, w: 10, d: 10, stories: 2, style: 'wood', color: '#b89a7a', sign: night ? 'store' : 'telegraph', falseFront: 1.4, yaw: 62 * DEG, lit: night });
    this.building({ x: half + 12, z: -74, w: 10, d: 10, stories: 1, style: 'adobe', color: '#d4a884', sign: night ? 'blacksmith' : 'barber', falseFront: 1.2, yaw: -62 * DEG, lit: night });
    // near-side low buildings at the street ends (backs to the player)
    for (const sx of [-1, 1]) {
      this.building({ x: sx * (half - 10), z: -58, w: 12, d: 8, stories: 1, style: 'wood', color: '#a08060', falseFront: 0.4, gable: true, yaw: Math.PI, porch: false, windows: 2 });
    }

    // street dressing + cover
    const streetZ = -76;
    this.streetZ = streetZ;
    const streetMat = new THREE.MeshStandardMaterial({ map: this.assets.texRepeat('street_tracks.png', total / 20, 1), transparent: true, depthWrite: false, roughness: 1 });
    const street = new THREE.Mesh(new THREE.PlaneGeometry(total + 80, 14), streetMat);
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, this.heightAt(0, streetZ) + 0.03, streetZ);
    street.receiveShadow = true;
    this.static.add(street);
    const coverProps = night
      ? [['wagon', -48, -77.5, 0.1, 1.2], ['barrel', -30, -79, 0, 0.8], ['crate_stack', -12, -78.5, 0.2, 0.9], ['trough', 6, -79.5, 0, 0.7], ['gallows', 22, -73, 0.3, 2.2], ['barrel', 36, -79, 0, 0.8], ['covered_wagon', 54, -76.5, -0.2, 1.3], ['crate', 70, -79, 0.4, 0.8]]
      : [['wagon', -56, -77, 0.15, 1.2], ['barrel', -40, -79.5, 0, 0.8], ['trough', -25, -79.5, 0, 0.7], ['crate_stack', -8, -78.5, 0.1, 0.9], ['well', 6, -75, 0, 1.2], ['barrel', 20, -79.5, 0, 0.8], ['covered_wagon', 34, -76.5, -0.15, 1.3], ['crate', 50, -79, 0.5, 0.8], ['hay_bale', 64, -79.5, 0.2, 0.7]];
    for (const [name, px, pz, yaw, cover] of coverProps) this.placeProp(name, px, pz, yaw, { cover, coverHeight: name.includes('wagon') ? 1.5 : 1 });
    for (let i = 0; i < 6; i++) this.placeProp('hitching_post', -60 + i * 24 + rand(-3, 3), -81.4, 0, { collide: true });
    for (let i = 0; i < 9; i++) this.placeProp('barrel', rand(-half, half), -82.2 + rand(-0.3, 0.3), rand(0, 6));
    for (let i = 0; i < 4; i++) this.placeProp('bench', -60 + i * 38 + rand(-4, 4), -83.2, 0, { collide: false });
    for (let i = 0; i < 5; i++) this.placeProp('telegraph_pole', -half - 30 + i * ((total + 60) / 4), -68, 0, { collide: false });
    this.placeProp('sign_post', -half - 4, -70, 0.3, { collide: false });
    if (this.preset.lamps) for (let i = 0; i < 4; i++) this.placeProp('lamp_post', -54 + i * 36, -70.5, Math.PI, { collide: false });
    this.placeProp('water_tower', half + 26, -96, 0);
    this.placeProp('windmill', -half - 28, -100, 0.4);
    this.placeProp('outhouse', half + 6, -97, 0.2);
    this.placeProp('coffin_stand', 34.5, -83.4, 0, { collide: false });
    this.placeProp('fence', -half - 14, -88, 0.3, { collide: false });
    this.placeProp('fence', -half - 17, -90, 0.3, { collide: false });

    // exits for runners/riders + civilian walking lanes
    this.spawns.exit.push(new THREE.Vector3(-half - 45, this.heightAt(-half - 45, streetZ), streetZ), new THREE.Vector3(half + 45, this.heightAt(half + 45, streetZ), streetZ));
    this.spawns.civilianPath.push({ z: -83.6, x0: -half + 2, x1: half - 2, y: 0.3 }, { z: -72, x0: -half, x1: half, y: 0 }, { z: -78, x0: -half, x1: half, y: 0 });
    // rider lanes run along the clear near side of the street
    this.spawns.rider.push({ z: streetZ + 5.5, x0: -half - 70, x1: half + 70 }, { z: streetZ + 8.5, x0: -half - 70, x1: half + 70 });
    this.spawns.runnerStart = this.spawns.door.slice();
    for (const s of this.spawns.street) this.spawns.hostage.push({ type: 'hostage', pos: s.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0, 2.2)), yaw: 0, occupied: false });
    for (const sp of this.spawns.door) this.spawns.hostage.push({ type: 'hostage', pos: sp.pos.clone().add(new THREE.Vector3(0, 0, 0.6)), yaw: sp.yaw, occupied: false, porch: true });

    // terrace row behind the main street
    const ty = this.terrace.h + 0.02;
    const terraceRow = night
      ? [{ x: -58, w: 12, stories: 2, style: 'adobe', color: '#c49a74', sign: 'station', falseFront: 1.2, name: 'mine office' }, { x: -20, w: 9, stories: 2, style: 'wood', color: '#8a7a6a', falseFront: 1.4, stepped: true }, { x: 26, w: 14, stories: 2, style: 'wood', color: '#a8a090', sign: 'hotel', falseFront: 1.8, balcony: true }, { x: 64, w: 10, stories: 1, style: 'adobe', color: '#d8b490', falseFront: 1.2 }]
      : [{ x: -62, w: 10, stories: 1, style: 'adobe', color: '#e6c49c', falseFront: 1.2 }, { x: -30, w: 12, stories: 2, style: 'wood', color: '#b8a088', falseFront: 1.6, stepped: true, balcony: true }, { x: 30, w: 11, stories: 2, style: 'wood', color: '#c8b498', sign: 'store', falseFront: 1.4 }, { x: 64, w: 9, stories: 1, style: 'adobe', color: '#dcb48e', falseFront: 1.0 }];
    for (const b of terraceRow) this.building({ ...b, z: this.terrace.z - 16, d: 10, baseY: ty, lit: night && chance(0.7) });
    this.church(night ? 2 : -2, this.terrace.z - 30, ty);
    if (night) {
      this.mineEntrance(-110, -150);
      this.placeProp('mine_cart', -98, -140, 0.4, { y: this.heightAt(-98, -140) });
    }
  }

  church(x, z, y) {
    const A = this.assets;
    const g = new THREE.Group();
    const mat = A.surface('adobe', 4, '#f0dcc0', { bump: 0.3 });
    const body = new THREE.Mesh(A.boxGeo(12, 8, 18, 4), mat);
    body.position.set(0, 4, 0);
    const tower = new THREE.Mesh(A.boxGeo(5, 15, 5, 4), mat);
    tower.position.set(0, 7.5, 9);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3.2, 4), A.surface('wood_planks', 2, '#5a3c26'));
    cap.position.set(0, 16.6, 9);
    cap.rotation.y = Math.PI / 4;
    const crossV = new THREE.Mesh(A.boxGeo(0.2, 1.6, 0.2, 1), A.mat('woodDark'));
    crossV.position.set(0, 19, 9);
    const crossH = new THREE.Mesh(A.boxGeo(0.9, 0.2, 0.2, 1), A.mat('woodDark'));
    crossH.position.set(0, 19.3, 9);
    const belfry = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), new THREE.MeshBasicMaterial({ color: '#100a06' }));
    belfry.position.set(0, 12.2, 11.52);
    const bell = A.build('church_bell');
    bell.position.set(0, 13.3, 11.0);
    // bell-tower ledge with a low parapet: the sniper perch
    const ledge = new THREE.Mesh(A.boxGeo(3.2, 0.25, 1.4, 2), mat);
    ledge.position.set(0, 10.35, 12.2);
    const parapet = new THREE.Mesh(A.boxGeo(3.2, 1.0, 0.2, 2), mat);
    parapet.position.set(0, 10.95, 12.85);
    for (const m of [body, tower, cap, crossV, crossH, ledge, parapet]) { m.castShadow = m.receiveShadow = true; m.userData.surface = 'stone'; g.add(m); this.colliders.push(m); }
    g.add(belfry, bell);
    g.position.set(x, y, z);
    this.static.add(g);
    g.updateMatrixWorld(true);
    const perch = new THREE.Vector3(0, 10.48, 12.2).applyMatrix4(g.matrixWorld);
    this.spawns.sniper.push({ type: 'sniper', pos: perch, hidden: perch.clone().add(new THREE.Vector3(0, -0.95, 0)), occupied: false, yaw: 0 });
    this.bell = bell;
  }

  mineEntrance(x, z) {
    const A = this.assets;
    const y = this.heightAt(x, z);
    const rock = A.surface('rock', 10, '#9a8a8a');
    const hill = new THREE.Mesh(new THREE.DodecahedronGeometry(18, 1), rock);
    hill.scale.set(1.4, 0.8, 1);
    hill.position.set(x, y + 2, z - 12);
    hill.castShadow = hill.receiveShadow = true;
    hill.userData.surface = 'stone';
    this.static.add(hill);
    this.colliders.push(hill);
    const frame = new THREE.Group();
    const beam = A.mat('woodDark');
    for (const sx of [-1.6, 1.6]) {
      const p = new THREE.Mesh(A.boxGeo(0.35, 3.6, 0.35, 2), beam);
      p.position.set(sx, 1.8, 0);
      frame.add(p);
    }
    const top = new THREE.Mesh(A.boxGeo(4.2, 0.4, 0.4, 2), beam);
    top.position.set(0, 3.7, 0);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.5), new THREE.MeshBasicMaterial({ color: '#050403' }));
    dark.position.set(0, 1.75, -0.2);
    frame.add(top, dark);
    frame.position.set(x + 4, y, z + 4);
    frame.rotation.y = 0.3;
    this.static.add(frame);
    if (this.preset.lamps) {
      const lan = A.build('lantern_hook');
      lan.position.set(0, 3.4, 0.3);
      frame.add(lan);
      this.registerLamp(lan, frame);
    }
  }

  buildJunction() {
    const A = this.assets;
    const trackZ = -66;
    this.streetZ = -58;
    // rails + ties
    const railMat = A.mat('steel');
    for (const off of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(900, 0.14, 0.1), railMat);
      rail.position.set(0, this.heightAt(0, trackZ) + 0.32, trackZ + off);
      rail.userData.surface = 'metal';
      this.static.add(rail);
      this.colliders.push(rail);
    }
    const tieGeo = A.boxGeo(0.25, 0.16, 2.4, 2);
    const ties = new THREE.InstancedMesh(tieGeo, A.mat('woodDark'), 700);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 700; i++) {
      const x = -450 + i * 1.3;
      mtx.makeTranslation(x, this.heightAt(x, trackZ) + 0.18, trackZ);
      ties.setMatrixAt(i, mtx);
    }
    ties.receiveShadow = true;
    this.static.add(ties);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(900, 0.2, 4), new THREE.MeshStandardMaterial({ color: '#7a6a5a', roughness: 1, map: A.texRepeat('sand.jpg', 100, 1) }));
    bed.position.set(0, this.heightAt(0, trackZ) + 0.02, trackZ);
    bed.receiveShadow = true;
    this.static.add(bed);
    this.trackZ = trackZ;

    // station + platform
    const zF = -82;
    const row = [
      { x: -84, w: 14, stories: 1, style: 'wood', color: '#8a5a3a', falseFront: 0.5, gable: true, sign: 'livery', name: 'warehouse' },
      { x: -56, w: 10, stories: 2, style: 'wood', color: '#c8a078', sign: 'telegraph', falseFront: 1.4, balcony: true },
      { x: -18, w: 20, stories: 2, style: 'wood', color: '#c84a32', trim: '#e6d6b8', sign: 'station', falseFront: 1.6, stepped: true, balcony: true, shutters: '#2a3a4a' },
      { x: 16, w: 10, stories: 2, style: 'brick', color: '#ffffff', sign: 'bank', falseFront: 1.3 },
      { x: 44, w: 12, stories: 2, style: 'wood', color: '#b07850', sign: 'saloon', falseFront: 2.0, stepped: true, balcony: true },
      { x: 76, w: 10, stories: 1, style: 'adobe', color: '#dca880', sign: 'assay', falseFront: 1.3 },
    ];
    for (const b of row) this.building({ ...b, z: zF - 5.5, d: 11, lit: chance(this.preset.windowsLit) });
    const plat = new THREE.Mesh(A.boxGeo(60, 0.6, 5, 2.4), A.surface('wood_planks', 2.4, '#9a7a5a'));
    plat.position.set(-18, this.heightAt(-18, -73) + 0.3, -73.5);
    plat.receiveShadow = plat.castShadow = true;
    plat.userData.surface = 'wood';
    this.static.add(plat);
    this.colliders.push(plat);
    this.placeProp('water_tower', 30, -73, 0.2);
    const props = [['crate_stack', -40, -74, 0.1, 0.9], ['barrel', -30, -74.5, 0, 0.8], ['wagon', 60, -60, -0.25, 1.2], ['crate', 4, -74.5, 0.4, 0.8], ['trough', 94, -78, 0.2, 0.7], ['hay_bale', -70, -76, 0.1, 0.7], ['covered_wagon', -100, -62, 0.4, 1.3], ['barrel', 86, -60, 0, 0.8]];
    for (const [name, px, pz, yaw, cover] of props) this.placeProp(name, px, pz, yaw, { cover, coverHeight: name.includes('wagon') ? 1.5 : 1 });
    for (let i = 0; i < 8; i++) this.placeProp('fence', 100 + (i % 4) * 3.1, -86 + Math.floor(i / 4) * 8, 0, { collide: false });
    for (let i = 0; i < 6; i++) this.placeProp('telegraph_pole', -140 + i * 56, -61, 0, { collide: false });
    if (this.preset.lamps) for (const lx of [-40, -18, 4]) this.placeProp('lamp_post', lx, -71.5, Math.PI, { collide: false, y: this.heightAt(lx, -71.5) + 0.6 });
    this.placeProp('windmill', 120, -100, 0.4);

    this.spawns.exit.push(new THREE.Vector3(-150, this.heightAt(-150, -58), -58), new THREE.Vector3(150, this.heightAt(150, -58), -58));
    this.spawns.civilianPath.push({ z: -73.5, x0: -46, x1: 10, y: 0.6 }, { z: -86, x0: -90, x1: 80, y: 0.3 });
    this.spawns.rider.push({ z: -56, x0: -135, x1: 135 }, { z: -52, x0: -135, x1: 135 });
    this.spawns.runnerStart = this.spawns.door.slice();
    for (const sp of this.spawns.door) this.spawns.hostage.push({ type: 'hostage', pos: sp.pos.clone().add(new THREE.Vector3(0, 0, 0.6)), yaw: sp.yaw, occupied: false, porch: true });
    for (const s of this.spawns.street) this.spawns.hostage.push({ type: 'hostage', pos: s.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0, 2.2)), yaw: 0, occupied: false });

    // terrace buildings
    const ty = this.terrace.h + 0.02;
    for (const b of [{ x: -50, w: 12, stories: 2, style: 'wood', color: '#b8a088', sign: 'hotel', falseFront: 1.5, balcony: true }, { x: 10, w: 10, stories: 1, style: 'adobe', color: '#e2b890', falseFront: 1.2 }, { x: 52, w: 11, stories: 2, style: 'wood', color: '#8a9aa0', sign: 'store', falseFront: 1.6, stepped: true }]) {
      this.building({ ...b, z: this.terrace.z - 20, d: 10, baseY: ty, lit: chance(this.preset.windowsLit) });
    }
    this.church(-10, this.terrace.z - 40, ty);
    this.train = new Train(this, trackZ);
  }

  // Distant canyon buttes with sniper perches on their flat tops (all layouts)
  buildRidge() {
    const A = this.assets;
    const tint = this.timeName === 'night' ? '#7a809a' : this.timeName === 'sunset' ? '#e0a080' : '#e8c0a0';
    const rock = A.surface('rock', 9, tint, { roughness: 1 });
    const z0 = this.layout === 'junction' ? -238 : -258;
    const xs = [-165, -110, -52, 8, 64, 118, 172];
    xs.forEach((x, i) => {
      const r = 9 + (i % 3) * 3.5;
      const h = 16 + ((i * 7) % 5) * 3;
      const geo = new THREE.CylinderGeometry(r * 0.78, r * 1.3, h, 22, 6);
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k);
        const ang = Math.atan2(v.z, v.x);
        const n = 1 + Math.sin(ang * 4 + i) * 0.1 + Math.sin(ang * 11 + i * 3) * 0.05 + Math.sin(v.y * 0.6 + ang * 2) * 0.04;
        v.x *= n; v.z *= n;
        if (v.y > h / 2 - 0.5) v.y += Math.sin(ang * 6 + i) * 0.35;
        pos.setXYZ(k, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 5, uv.getY(k) * h / 10);
      const m = new THREE.Mesh(geo, rock);
      const zz = z0 - (i % 2) * 14;
      const gy = this.heightAt(x, zz);
      m.position.set(x, gy + h / 2 - 1, zz);
      m.castShadow = m.receiveShadow = true;
      m.userData.surface = 'stone';
      this.static.add(m);
      this.colliders.push(m);
      // talus boulders at the foot
      for (let b = 0; b < 4; b++) {
        const bo = A.build('rock_big');
        bo.scale.setScalar(rand(0.8, 1.6));
        const ang = rand(0, Math.PI * 2);
        bo.position.set(x + Math.cos(ang) * r * 1.4, gy, zz + Math.sin(ang) * r * 1.4);
        bo.rotation.y = rand(0, 6);
        this.static.add(bo);
      }
      // sniper perch on the near rim of the flat top, behind a boulder
      const top = gy + h - 1;
      const p = new THREE.Vector3(x + rand(-r * 0.3, r * 0.3), top, zz + r * 0.55);
      this.spawns.sniper.push({ type: 'sniper', pos: p, hidden: p.clone().add(new THREE.Vector3(0, -1.0, -1.4)), occupied: false, yaw: 0, ridge: true });
      const cover = A.build('rock_big');
      cover.scale.set(0.55, 0.5, 0.45);
      cover.position.copy(p).add(new THREE.Vector3(0.3, -0.35, 1.3));
      this.static.add(cover);
      this.colliders.push(cover);
    });
  }

  scatterNature() {
    const r = this.rng;
    for (let i = 0; i < 90; i++) {
      const x = (r() - 0.5) * 520;
      const z = -30 - r() * 380;
      if (Math.abs(z - (this.streetZ ?? -76)) < 22 && Math.abs(x) < 130) continue;
      if (z < -100 && z > -170 && Math.abs(x) < 110) continue;
      const kind = r() < 0.18 ? 'saguaro' : r() < 0.4 ? 'cactus_small' : r() < 0.7 ? 'shrub' : r() < 0.85 ? 'rock_small' : 'rock_big';
      this.placeProp(kind, x, z, r() * 6, { collide: kind === 'saguaro' || kind === 'rock_big', scale: 0.8 + r() * 0.6 });
    }
    // foreground on the vantage hill
    for (let i = 0; i < 26; i++) {
      const x = (r() - 0.5) * 120;
      const z = -6 - r() * 34;
      if (Math.abs(x) < 4 && z > -10) continue;
      const kind = pick(['shrub', 'rock_small', 'cactus_small', 'shrub', 'rock_big']);
      this.placeProp(kind, x, z, r() * 6, { collide: false, scale: 0.7 + r() * 0.8 });
    }
    for (const [x, z] of [[-14, -22], [18, -30], [-34, -36], [40, -16]]) this.placeProp('saguaro', x, z, r() * 6, { collide: true, scale: 1.1 });
  }

  buildAmbient() {
    // tumbleweeds
    const twMat = new THREE.MeshStandardMaterial({ map: this.assets.tex('tumbleweed'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), twMat);
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), twMat);
      m.add(inner);
      m.castShadow = true;
      m.userData.dynamic = true;
      this.static.add(m);
      this.tumbleweeds.push({ mesh: m, x: rand(-150, 150), z: (this.streetZ ?? -76) + rand(-6, 6), v: rand(3, 6), bounce: 0, t: rand(0, 5) });
    }
    // vultures circling
    const birdMat = new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6), birdMat);
      body.rotation.x = Math.PI / 2;
      b.add(body);
      const wingGeo = new THREE.PlaneGeometry(1.3, 0.38);
      wingGeo.translate(0.65, 0, 0);
      const wl = new THREE.Mesh(wingGeo, birdMat); wl.rotation.x = -Math.PI / 2;
      const wr = new THREE.Mesh(wingGeo, birdMat); wr.rotation.x = -Math.PI / 2; wr.rotation.y = Math.PI;
      const wlp = new THREE.Group(); wlp.add(wl);
      const wrp = new THREE.Group(); wrp.add(wr);
      b.add(wlp, wrp);
      b.userData.dynamic = true;
      this.static.add(b);
      this.birds.push({ g: b, wl: wlp, wr: wrp, r: rand(25, 55), h: rand(55, 85), speed: rand(0.12, 0.2) * (i % 2 ? 1 : -1), phase: rand(0, 6), cx: rand(-40, 40), cz: rand(-130, -90) });
    }
    // drifting dust motes
    const n = 400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(-120, 120); pos[i * 3 + 1] = rand(0, 18); pos[i * 3 + 2] = rand(-160, -20); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({ map: this.assets.tex('dust'), size: 0.5, transparent: true, opacity: this.preset.ambientDust * 0.5, depthWrite: false, color: this.timeName === 'night' ? '#8090c0' : '#ffe8c8' });
    this.motes = new THREE.Points(geo, pm);
    this.static.add(this.motes);
  }

  // -------------------------------------------------------------- queries
  raycast(origin, dir, far) {
    this._rc ||= new THREE.Raycaster();
    this._rc.set(origin, dir);
    this._rc.far = far;
    const hits = this._rc.intersectObjects(this.colliders, true);
    return hits[0] || null;
  }

  /** Scatter red powder barrels next to the outlaws' cover and porches. */
  addExplosives(n) {
    const spots = [...this.spawns.street.map((s) => s.pos), ...this.spawns.door.map((s) => s.pos)];
    for (let i = 0; i < n && spots.length; i++) {
      const p = spots.splice(Math.floor(Math.random() * spots.length), 1)[0];
      const side = rand(1.1, 1.6) * (chance(0.5) ? 1 : -1);
      this.placeProp('barrel_explosive', p.x + side, p.z + rand(-0.4, 0.4), rand(0, 6), { y: this.heightAt(p.x + side, p.z) + (p.y - this.heightAt(p.x, p.z) > 0.2 ? p.y - this.heightAt(p.x, p.z) : 0) });
    }
  }

  explosiveFor(obj) {
    let o = obj;
    while (o) {
      if (o.userData?.explosive) return this.explosives.find((e) => e.obj === o && e.alive) || null;
      o = o.parent;
    }
    return null;
  }

  setWind(speed) {
    const a = rand(0, Math.PI * 2);
    this.wind.set(Math.cos(a) * speed, Math.sin(a) * speed * 0.3);
    if (speed === 0) this.wind.set(0, 0);
  }

  // -------------------------------------------------------------- update
  update(dt) {
    this.time += dt;
    const t = this.time;
    this.sky.material.uniforms.time.value = t;
    for (const fn of this.animated) fn(dt, t);
    for (const l of this.lampLights) l.light.intensity = this.preset.lamps ? l.base * (this.timeName === 'night' ? 1.4 : 0.7) * (0.92 + Math.sin(t * 9 + l.phase) * 0.04 + Math.sin(t * 23 + l.phase) * 0.04) : 0;
    const windX = this.wind.x || 2;
    for (const tw of this.tumbleweeds) {
      tw.t += dt;
      tw.x += Math.sign(windX) * tw.v * dt;
      tw.bounce += dt * 5;
      if (Math.abs(tw.x) > 170) { tw.x = -Math.sign(windX) * 170; tw.z = (this.streetZ ?? -76) + rand(-6, 6); tw.v = rand(3, 6); }
      const y = this.heightAt(tw.x, tw.z) + 0.45 + Math.abs(Math.sin(tw.bounce)) * 0.5;
      tw.mesh.position.set(tw.x, y, tw.z);
      tw.mesh.rotation.z -= Math.sign(windX) * tw.v * dt / 0.45;
    }
    for (const b of this.birds) {
      const a = t * b.speed + b.phase;
      b.g.position.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 0.3 + b.phase) * 3, b.cz + Math.sin(a) * b.r);
      b.g.rotation.y = -a + (b.speed > 0 ? Math.PI : 0);
      b.g.rotation.z = b.speed > 0 ? 0.25 : -0.25;
      const flap = Math.sin(t * 3 + b.phase) > 0.6 ? Math.sin(t * 9) * 0.5 : 0.1;
      b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
    }
    if (this.motes) {
      const p = this.motes.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) + (windX * 0.3 + Math.sin(t + i) * 0.2) * dt;
        if (x > 120) x = -120; else if (x < -120) x = 120;
        p.setX(i, x);
        p.setY(i, p.getY(i) + Math.sin(t * 0.7 + i * 1.3) * 0.05 * dt);
      }
      p.needsUpdate = true;
    }
    for (const s of this.smokeEmitters) {
      s.t += dt;
      if (s.t > 0.45) {
        s.t = 0;
        const wp = s.local.clone().applyMatrix4(s.group.matrixWorld);
        this.fx.sprite('smoke', wp, { size: 0.8, life: 4, vel: new THREE.Vector3(windX * 0.4 + rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2)), grow: 4, opacity: 0.22, drag: 0.1, color: this.timeName === 'night' ? '#5a5a66' : '#d8d0c8', fadeIn: 0.5 });
      }
    }
    if (this.train) this.train.update(dt);
    this.fx.update(dt);
  }
}

// ------------------------------------------------------------------ train
export class Train {
  constructor(world, z) {
    this.world = world;
    this.z = z;
    this.group = new THREE.Group();
    this.cars = [];
    this.wheels = [];
    this.active = false;
    this.x = -320;
    this.speed = 0;
    this.dir = 1;
    const A = world.assets;
    const cfg = A.json.characters.train;
    const y0 = world.heightAt(0, z) + 0.4;
    this.y0 = y0;
    let offset = 0;
    // locomotive
    const loco = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: cfg.locomotive.color, metalness: 0.7, roughness: 0.45 });
    const red = new THREE.MeshStandardMaterial({ color: cfg.locomotive.trim, roughness: 0.6 });
    const brass = A.mat('brass');
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 6, 20), iron);
    boiler.rotation.z = Math.PI / 2; boiler.position.set(1.0, 2.35, 0);
    const cab = new THREE.Mesh(A.boxGeo(2.8, 2.8, 2.8, 2), red);
    cab.position.set(-3.2, 2.9, 0);
    const cabRoof = new THREE.Mesh(A.boxGeo(3.2, 0.2, 3.2, 2), iron);
    cabRoof.position.set(-3.2, 4.4, 0);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.3, 1.8, 14), iron);
    stack.position.set(3.2, 4.0, 0);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), brass);
    dome.position.set(0.8, 3.4, 0);
    const lamp = new THREE.Mesh(A.boxGeo(0.6, 0.6, 0.6, 1), A.mat('glassLamp'));
    lamp.position.set(4.1, 3.2, 0);
    const catcher = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 4), red);
    catcher.rotation.z = -Math.PI / 2; catcher.rotation.x = Math.PI / 4; catcher.position.set(4.6, 0.9, 0);
    const frame = new THREE.Mesh(A.boxGeo(9, 0.5, 2.4, 2), iron);
    frame.position.set(0, 1.2, 0);
    loco.add(boiler, cab, cabRoof, stack, dome, lamp, catcher, frame);
    for (const wx of [-3, -1.2, 0.8, 2.8]) for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(wx > 0 ? 0.75 : 0.55, wx > 0 ? 0.75 : 0.55, 0.15, 16), red);
      w.rotation.x = Math.PI / 2; w.position.set(wx, wx > 0 ? 0.75 : 0.55, s * 1.15);
      loco.add(w); this.wheels.push(w);
    }
    loco.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.surface = 'metal'; } });
    loco.position.x = offset;
    this.stackLocal = new THREE.Vector3(3.2, 5, 0);
    this.loco = loco;
    this.group.add(loco);
    offset -= cfg.locomotive.length + 0.6;
    for (const c of cfg.cars) {
      const car = new THREE.Group();
      const mat = A.surface('wood_planks', 2, c.color);
      const L = c.length;
      const base = new THREE.Mesh(A.boxGeo(L, 0.4, 2.6, 2), iron);
      base.position.y = 1.2;
      car.add(base);
      let roofY = 1.4;
      if (c.type === 'box' || c.type === 'passenger') {
        const body = new THREE.Mesh(A.boxGeo(L, 3.0, 2.8, 2.4), mat);
        body.position.y = 2.9;
        car.add(body);
        const roof = new THREE.Mesh(A.boxGeo(L + 0.2, 0.18, 3.0, 2), iron);
        roof.position.y = 4.48;
        car.add(roof);
        roofY = 4.57;
        if (c.type === 'passenger') {
          for (let i = 0; i < 5; i++) {
            const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), new THREE.MeshBasicMaterial({ color: world.preset.windowsLit > 0.3 ? '#ffb060' : '#1a1410' }));
            win.position.set(-L / 2 + 1.3 + i * (L - 2.6) / 4, 3.1, 1.41);
            car.add(win);
          }
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const cr = A.build('crate');
          cr.position.set(-L / 3 + i * L / 3, 1.4, rand(-0.4, 0.4));
          car.add(cr);
        }
        roofY = 1.4;
      }
      for (const wx of [-L / 2 + 1.2, L / 2 - 1.2]) for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), iron);
        w.rotation.x = Math.PI / 2; w.position.set(wx, 0.45, s * 1.15);
        car.add(w); this.wheels.push(w);
      }
      car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.surface = o.material === mat ? 'wood' : 'metal'; } });
      car.position.x = offset - L / 2;
      this.group.add(car);
      // roof slots for outlaws (local to car)
      const slots = c.type === 'flat' ? [-L / 3, L / 3] : [-L / 4, L / 4];
      this.cars.push({ group: car, roofY, slots: slots.map((sx) => ({ x: sx, used: false })) });
      offset -= L + 0.6;
    }
    this.length = -offset;
    this.group.position.set(this.x, y0, z);
    this.group.visible = false;
    this.group.userData.dynamic = true;
    world.static.add(this.group);
    this.colliderObjs = [this.group];
  }

  start(speed = 9, dir = 1) {
    this.active = true;
    this.dir = dir;
    this.speed = speed;
    this.x = dir > 0 ? -175 : 175;
    this.group.rotation.y = dir > 0 ? 0 : Math.PI;
    this.group.visible = true;
    if (!this.world.colliders.includes(this.group)) this.world.colliders.push(this.group);
    this.whistle = 0;
  }

  // Returns a world-space anchor object an actor can parent to (stands on the roof).
  slot() {
    for (const c of shuffleCopy(this.cars)) {
      const s = c.slots.find((q) => !q.used);
      if (s) {
        s.used = true;
        const anchor = new THREE.Group();
        anchor.position.set(s.x + rand(-0.8, 0.8), c.roofY, rand(-0.5, 0.5));
        c.group.add(anchor);
        return anchor;
      }
    }
    return null;
  }

  get passed() { return this.dir > 0 ? this.x - this.length > 260 : this.x + this.length < -260; }

  update(dt) {
    if (!this.active) return;
    this.x += this.speed * this.dir * dt;
    this.group.position.x = this.x;
    for (const w of this.wheels) w.rotation.y += this.speed * dt / 0.6;
    this.puff = (this.puff || 0) + dt;
    if (this.puff > 0.12) {
      this.puff = 0;
      const p = this.stackLocal.clone().applyMatrix4(this.loco.matrixWorld);
      this.world.fx.sprite('smoke', p, { size: 1.2, life: 3.5, vel: new THREE.Vector3(-this.speed * this.dir * 0.4, rand(2.5, 4), rand(-0.4, 0.4)), grow: 4, opacity: 0.55, drag: 0.6, color: '#4a4440' });
    }
    if (this.passed) { this.active = false; this.group.visible = false; }
  }
}

function shuffleCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

