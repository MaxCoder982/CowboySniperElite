// actors.js — procedural skeletal characters (outlaws, bosses, civilians), horses,
// pose-blended animation, hitboxes, deaths, and every enemy / civilian behaviour.
import * as THREE from 'three';
import { clamp, lerp, damp, rand, pick, chance, segSphere, segCapsule, easeInQuad } from './core.js';

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'thL', 'thR', 'knL', 'knR'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// ------------------------------------------------------------------ poses (radians)
function pose(over = {}) {
  const p = { hipY: 0, lean: 0 };
  for (const j of JOINTS) p[j] = [0, 0, 0];
  p.shL = [0.05, 0, 0.12]; p.shR = [0.05, 0, -0.12];
  p.elL = [-0.15, 0, 0]; p.elR = [-0.15, 0, 0];
  for (const k in over) p[k] = Array.isArray(over[k]) ? over[k].slice() : over[k];
  return p;
}
const POSES = {
  stand: pose(),
  crouch: pose({ hipY: -0.42, spine: [0.35, 0, 0], neck: [-0.25, 0, 0], thL: [-1.35, 0, 0.12], thR: [-1.25, 0, -0.12], knL: [2.0, 0, 0], knR: [1.9, 0, 0], shL: [-0.5, 0, 0.2], shR: [-0.6, 0, -0.2], elL: [-0.9, 0, 0], elR: [-0.9, 0, 0] }),
  aimRifle: pose({ spine: [0.05, 0, 0], shR: [-0.95, 0.2, -0.35], elR: [-1.35, 0, 0], shL: [-1.45, 0, -0.32], elL: [-0.35, 0, 0], head: [0.12, -0.12, 0] }),
  crouchAim: pose({ hipY: -0.42, spine: [0.2, 0, 0], thL: [-1.35, 0, 0.12], thR: [-1.25, 0, -0.12], knL: [2.0, 0, 0], knR: [1.9, 0, 0], shR: [-0.95, 0.2, -0.35], elR: [-1.35, 0, 0], shL: [-1.45, 0, -0.32], elL: [-0.35, 0, 0], head: [0.12, -0.12, 0] }),
  aimPistol: pose({ shR: [-1.55, 0, 0.05], elR: [0, 0, 0], shL: [0.1, 0, 0.18], elL: [-0.3, 0, 0], spine: [0, -0.25, 0] }),
  handsUp: pose({ shL: [0, 0, 2.7], shR: [0, 0, -2.7], elL: [0, 0, 0.5], elR: [0, 0, -0.5], head: [0.15, 0, 0] }),
  cower: pose({ hipY: -0.4, spine: [0.6, 0, 0], thL: [-1.3, 0, 0.15], thR: [-1.3, 0, -0.15], knL: [2.0, 0, 0], knR: [2.0, 0, 0], shL: [-2.2, 0, -0.4], shR: [-2.2, 0, 0.4], elL: [-1.8, 0, 0], elR: [-1.8, 0, 0], neck: [0.4, 0, 0] }),
  ride: pose({ hipY: 0, thL: [-1.25, 0, 0.55], thR: [-1.25, 0, -0.55], knL: [1.3, 0, 0], knR: [1.3, 0, 0], shL: [-0.7, 0, 0.1], shR: [-0.7, 0, -0.1], elL: [-0.9, 0, 0], elR: [-0.9, 0, 0], spine: [0.15, 0, 0] }),
  rideAim: pose({ thL: [-1.25, 0, 0.55], thR: [-1.25, 0, -0.55], knL: [1.3, 0, 0], knR: [1.3, 0, 0], shR: [-1.55, 0, 0.05], elR: [0, 0, 0], shL: [-0.7, 0, 0.1], elL: [-0.9, 0, 0] }),
  holdHostage: pose({ shL: [-1.1, 0, -0.75], elL: [-1.1, 0, 0], shR: [-1.9, 0, 0.35], elR: [-0.5, 0, 0], spine: [0.05, 0, 0] }),
  carry: pose({ shR: [-0.2, 0, -0.35], elR: [-0.4, 0, 0], shL: [-0.6, 0, 0.25], elL: [-1.2, 0, 0] }),
};

// ------------------------------------------------------------------ character rig
export class Rig {
  /** look: { kind, skin, shirt, vest, coat, pants, hat, hatType, bandana, mask, boots, belt, weapon, mustache, dress, bonnet, scale } */
  constructor(assets, look) {
    this.assets = assets;
    this.look = look;
    const R = assets.json.characters.rig;
    this.R = R;
    this.mats = [];
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();          // death pivot
    this.body = new THREE.Group();           // offset under pivot
    this.root.add(this.pivot);
    this.pivot.add(this.body);
    const s = look.scale || 1;
    this.body.scale.setScalar(s);
    this.j = {};
    const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); this.j[name] = g; return g; };
    const hips = J('hips', this.body, 0, R.hipHeight, 0);
    const spine = J('spine', hips, 0, 0.06, 0);
    const chest = J('chest', spine, 0, R.spine, 0);
    const neck = J('neck', chest, 0, R.chest + 0.02, 0);
    const head = J('head', neck, 0, R.neck, 0);
    const shL = J('shL', chest, R.shoulderWidth, R.chest - 0.04, 0);
    const shR = J('shR', chest, -R.shoulderWidth, R.chest - 0.04, 0);
    const elL = J('elL', shL, 0, -R.upperArm, 0);
    const elR = J('elR', shR, 0, -R.upperArm, 0);
    const thL = J('thL', hips, R.hipWidth, -0.02, 0);
    const thR = J('thR', hips, -R.hipWidth, -0.02, 0);
    const knL = J('knL', thL, 0, -R.thigh, 0);
    const knR = J('knR', thR, 0, -R.thigh, 0);

    const L = look;
    const m = (c, rough = 0.9, extra = {}) => { const mm = new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...extra }); this.mats.push(mm); return mm; };
    const cloth = assets.tex('cloth');
    const skin = m(L.skin, 0.75);
    const shirt = new THREE.MeshStandardMaterial({ color: L.shirt, roughness: 0.95, map: cloth }); this.mats.push(shirt);
    const pants = new THREE.MeshStandardMaterial({ color: L.pants, roughness: 0.95, map: cloth }); this.mats.push(pants);
    const torsoMat = L.coat ? m(L.coat, 0.85) : L.vest ? m(L.vest, 0.8) : shirt;
    const armMat = L.coat ? torsoMat : shirt;
    const boots = m(L.boots, 0.6);
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z); o.scale.set(sx, sy, sz);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
    // torso + hips
    const T = R.torso;
    mesh(cap(T.radius, T.length), torsoMat, chest, 0, 0.13, 0, ...T.scale);
    if (L.vest && !L.coat) mesh(new THREE.BoxGeometry(0.1, 0.36, 0.05), shirt, chest, 0, 0.14, 0.115);
    mesh(cap(R.hips.radius, R.hips.length), L.dress ? m(L.dress) : pants, hips, 0, -0.02, 0, ...R.hips.scale);
    const belt = m(L.belt || '#3a2414', 0.6);
    mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.06, 14), belt, hips, 0, 0.06, 0, 1.06, 1, 0.76);
    mesh(new THREE.BoxGeometry(0.07, 0.06, 0.02), m('#c8963c', 0.3, { metalness: 1 }), hips, 0, 0.06, 0.13);
    if (L.kind !== 'lady') mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), belt, hips, -0.17, -0.05, 0.02);
    if (L.coat) {
      const skirt = new THREE.CylinderGeometry(0.19, 0.27, 0.62, 12, 1, true);
      mesh(skirt, m(L.coat, 0.85, { side: THREE.DoubleSide }), hips, 0, -0.3, -0.01, 1, 1, 0.78);
    }
    if (L.dress) {
      mesh(new THREE.CylinderGeometry(0.17, 0.42, 0.95, 16, 1, true), m(L.dress, 0.9, { side: THREE.DoubleSide }), hips, 0, -0.47, 0, 1, 1, 0.85);
    }
    // neck + head
    mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin, neck, 0, 0.04, 0);
    const hr = R.headRadius;
    mesh(new THREE.SphereGeometry(hr, 16, 12), skin, head, 0, 0.1, 0, 0.88, 1.05, 0.95);
    mesh(new THREE.BoxGeometry(0.03, 0.05, 0.04), skin, head, 0, 0.09, 0.105);
    const eye = m('#1a120c', 0.4);
    mesh(new THREE.SphereGeometry(0.013, 6, 6), eye, head, 0.038, 0.125, 0.093);
    mesh(new THREE.SphereGeometry(0.013, 6, 6), eye, head, -0.038, 0.125, 0.093);
    const brow = m(L.hair || '#2a1a10', 0.9);
    mesh(new THREE.BoxGeometry(0.04, 0.01, 0.02), brow, head, 0.04, 0.148, 0.098);
    mesh(new THREE.BoxGeometry(0.04, 0.01, 0.02), brow, head, -0.04, 0.148, 0.098);
    if (L.mustache) mesh(new THREE.BoxGeometry(0.09, 0.022, 0.03), brow, head, 0, 0.062, 0.105);
    if (L.beard) mesh(new THREE.SphereGeometry(0.075, 10, 8), brow, head, 0, 0.03, 0.05, 1, 0.9, 0.8);
    if (L.bandana) {
      if (L.mask) mesh(new THREE.CylinderGeometry(0.104, 0.11, 0.09, 14, 1, true, -1.9, 3.8), m(L.bandana, 0.9, { side: THREE.DoubleSide }), head, 0, 0.065, 0.004);
      mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 12), m(L.bandana), neck, 0, 0.0, 0.0, 1, 1, 1).rotation.x = Math.PI / 2;
    }
    // hat
    this.hat = null;
    if (L.hatType && L.hatType !== 'none') {
      const prof = L.hatType === 'bowler' ? assets.json.characters.bowlerProfile : L.hatType === 'bonnet' ? assets.json.characters.bonnetProfile : assets.json.characters.hatProfile;
      const geo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 20);
      const hatMat = m(L.hat, 0.95, { side: THREE.DoubleSide });
      const hat = new THREE.Mesh(geo, hatMat);
      hat.castShadow = true;
      const crownPinch = L.hatType === 'cowboy' ? 0.86 : 1;
      hat.scale.set(1, 1, crownPinch);
      hat.position.set(0, L.hatType === 'bonnet' ? 0.13 : 0.16, L.hatType === 'bonnet' ? -0.02 : 0);
      if (L.hatType === 'bonnet') hat.rotation.x = -0.5;
      if (L.hatType === 'cowboy') {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.114, 0.119, 0.025, 16, 1, true), m('#1a120c', 0.6, { side: THREE.DoubleSide }));
        band.position.y = 0.04;
        hat.add(band);
      }
      head.add(hat);
      this.hat = hat;
    }
    // arms
    const ar = R.limbRadius;
    mesh(cap(ar.upperArm, R.upperArm - 0.06), armMat, shL, 0, -R.upperArm / 2, 0);
    mesh(cap(ar.upperArm, R.upperArm - 0.06), armMat, shR, 0, -R.upperArm / 2, 0);
    mesh(cap(ar.foreArm, R.foreArm - 0.08), armMat, elL, 0, -R.foreArm / 2, 0);
    mesh(cap(ar.foreArm, R.foreArm - 0.08), armMat, elR, 0, -R.foreArm / 2, 0);
    const glove = L.gloves ? m(L.gloves, 0.7) : skin;
    mesh(new THREE.SphereGeometry(0.048, 8, 8), glove, elL, 0, -R.foreArm, 0, 1, 1.2, 0.8);
    this.handR = new THREE.Group(); this.handR.position.set(0, -R.foreArm, 0); elR.add(this.handR);
    mesh(new THREE.SphereGeometry(0.048, 8, 8), glove, this.handR, 0, 0, 0, 1, 1.2, 0.8);
    // legs
    const legMat = L.dress ? m(L.dress) : pants;
    mesh(cap(ar.thigh, R.thigh - 0.1), legMat, thL, 0, -R.thigh / 2, 0);
    mesh(cap(ar.thigh, R.thigh - 0.1), legMat, thR, 0, -R.thigh / 2, 0);
    mesh(cap(ar.shin, R.shin - 0.12), boots, knL, 0, -R.shin / 2, 0);
    mesh(cap(ar.shin, R.shin - 0.12), boots, knR, 0, -R.shin / 2, 0);
    mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), boots, knL, 0, -R.shin + 0.01, 0.05);
    mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), boots, knR, 0, -R.shin + 0.01, 0.05);
    if (L.dress) { this.j.thL.visible = false; this.j.thR.visible = false; }

    // weapon
    this.weapon = null;
    this.muzzle = new THREE.Vector3();
    if (L.weapon === 'rifle' || L.weapon === 'scoped') {
      const w = assets.build(L.weapon === 'scoped' ? 'enemy_scoped' : 'enemy_rifle', 'rifles');
      w.rotation.y = Math.PI;
      w.position.set(-0.1, 0.2, 0.2);
      chest.add(w);
      this.weapon = w;
      this.weaponMode = 'rifle';
    } else if (L.weapon === 'revolver') {
      const w = assets.build('revolver', 'rifles');
      w.rotation.x = -Math.PI / 2;
      w.position.set(0, -0.03, 0.02);
      this.handR.add(w);
      this.weapon = w;
      this.weaponMode = 'pistol';
    }
    if (this.weapon) {
      const def = this.weapon.userData.def;
      this.muzzleLocal = new THREE.Vector3(...(def.muzzle || [0, 0, -0.5]));
      this.glintLocal = def.glint ? new THREE.Vector3(...def.glint) : null;
    }
    if (L.loot) {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), m('#c8b48a', 1, { map: cloth }));
      bag.scale.set(1, 1.2, 0.9);
      bag.position.set(0, -0.15, 0.05);
      elL.add(bag);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.01), m('#3a2a1a'));
      sign.position.set(0, -0.12, 0.2);
      elL.add(sign);
    }
    if (L.dynamite) {
      const dy = assets.build('dynamite', 'rifles');
      dy.position.set(0, 0, 0.05);
      this.handR.add(dy);
    }

    this.cur = pose();
    // tiny details (eyes, brows, buckle, hands) don't need their own shadow pass
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) > 0.07;
    });
  }

  apply(target, dt, speed = 10) {
    const c = this.cur;
    c.hipY = damp(c.hipY, target.hipY, speed, dt);
    for (const j of JOINTS) {
      const a = c[j], b = target[j];
      a[0] = damp(a[0], b[0], speed, dt); a[1] = damp(a[1], b[1], speed, dt); a[2] = damp(a[2], b[2], speed, dt);
      this.j[j].rotation.set(a[0], a[1], a[2]);
    }
    this.j.hips.position.y = this.R.hipHeight + c.hipY;
  }

  muzzleWorld(out) {
    if (!this.weapon) return this.j.chest.getWorldPosition(out);
    return out.copy(this.muzzleLocal).applyMatrix4(this.weapon.matrixWorld);
  }

  setTint(color, amount) {
    const key = amount > 0 ? `${color}:${amount.toFixed(2)}` : 'off';
    if (key === this._tint) return;
    this._tint = key;
    for (const mm of this.mats) {
      mm.emissive.set(color);
      mm.emissiveIntensity = amount;
    }
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh && !o.geometry.userData.cached) o.geometry.dispose(); });
    for (const mm of this.mats) mm.dispose();
  }
}

// Walk / run procedural overlay added on top of a base pose.
function locomotion(p, phase, amount, run) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const A = run ? 0.85 : 0.5;
  p.thL[0] += -s * A * amount; p.thR[0] += s * A * amount;
  p.knL[0] += Math.max(0, s) * (run ? 1.4 : 0.8) * amount; p.knR[0] += Math.max(0, -s) * (run ? 1.4 : 0.8) * amount;
  p.shL[0] += s * (run ? 0.8 : 0.4) * amount; p.shR[0] += -s * (run ? 0.8 : 0.4) * amount;
  p.elL[0] += -(run ? 1.0 : 0.3) * amount; p.elR[0] += -(run ? 1.0 : 0.3) * amount;
  p.hipY += Math.abs(c) * (run ? 0.06 : 0.03) * amount - (run ? 0.05 : 0) * amount;
  p.spine[0] += (run ? 0.25 : 0.04) * amount;
  return p;
}

// ------------------------------------------------------------------ horse
export class Horse {
  constructor(assets, coat, mane) {
    const H = assets.json.characters.horse;
    this.root = new THREE.Group();
    this.mats = [];
    const m = (c) => { const mm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }); this.mats.push(mm); return mm; };
    const coatM = m(coat || pick(H.coats)), maneM = m(mane || pick(H.manes)), hoofM = m('#1a1410'), saddleM = m(H.saddle);
    const add = (geo, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz); o.castShadow = true; parent.add(o); return o;
    };
    this.bodyG = new THREE.Group(); this.bodyG.position.y = 1.5; this.root.add(this.bodyG);
    add(new THREE.CapsuleGeometry(0.42, 1.1, 6, 14), coatM, this.bodyG, 0, 0, 0, Math.PI / 2, 0, 0, 0.92, 1, 1);
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.2, 0.75); this.bodyG.add(this.neck);
    add(new THREE.CapsuleGeometry(0.2, 0.7, 4, 10), coatM, this.neck, 0, 0.35, 0.2, 0.75, 0, 0);
    add(new THREE.BoxGeometry(0.06, 0.6, 0.18), maneM, this.neck, 0, 0.42, 0.04, 0.75, 0, 0);
    this.headG = new THREE.Group(); this.headG.position.set(0, 0.72, 0.5); this.neck.add(this.headG);
    add(new THREE.CapsuleGeometry(0.13, 0.42, 4, 10), coatM, this.headG, 0, -0.05, 0.22, 1.9, 0, 0);
    add(new THREE.ConeGeometry(0.05, 0.14, 4), coatM, this.headG, 0.08, 0.18, 0.02);
    add(new THREE.ConeGeometry(0.05, 0.14, 4), coatM, this.headG, -0.08, 0.18, 0.02);
    const eyeM = m('#0a0806');
    add(new THREE.SphereGeometry(0.025, 6, 6), eyeM, this.headG, 0.11, 0.04, 0.12);
    add(new THREE.SphereGeometry(0.025, 6, 6), eyeM, this.headG, -0.11, 0.04, 0.12);
    this.tail = new THREE.Group(); this.tail.position.set(0, 0.15, -0.95); this.bodyG.add(this.tail);
    add(new THREE.ConeGeometry(0.1, 0.8, 6), maneM, this.tail, 0, -0.35, -0.08, -2.7, 0, 0);
    add(new THREE.BoxGeometry(0.6, 0.12, 0.7), saddleM, this.bodyG, 0, 0.42, 0.05);
    add(new THREE.BoxGeometry(0.66, 0.5, 0.5), m('#6a3a1e'), this.bodyG, 0, 0.18, 0.05, 0, 0, 0, 1, 1, 1);
    this.legs = [];
    for (const [x, z, front] of [[0.22, 0.62, true], [-0.22, 0.62, true], [0.22, -0.62, false], [-0.22, -0.62, false]]) {
      const up = new THREE.Group(); up.position.set(x, -0.28, z); this.bodyG.add(up);
      add(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), coatM, up, 0, -0.3, 0);
      const low = new THREE.Group(); low.position.set(0, -0.6, 0); up.add(low);
      add(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8), coatM, low, 0, -0.27, 0);
      add(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), hoofM, low, 0, -0.56, 0.01);
      this.legs.push({ up, low, front, phase: (front ? 0 : Math.PI) + (x > 0 ? 0.6 : 0) });
    }
    this.saddle = new THREE.Group(); this.saddle.position.set(0, 0.5, 0.05); this.bodyG.add(this.saddle);
    this.phase = 0;
  }

  update(dt, speed) {
    const gallop = clamp(speed / 10, 0, 1);
    this.phase += dt * (2 + speed * 0.9);
    for (const l of this.legs) {
      const s = Math.sin(this.phase + l.phase);
      l.up.rotation.x = s * (0.15 + 0.6 * gallop) * (l.front ? 1 : -1);
      l.low.rotation.x = (l.front ? -1 : 1) * Math.max(0, Math.cos(this.phase + l.phase)) * (0.2 + 1.0 * gallop);
    }
    this.bodyG.position.y = 1.5 + Math.abs(Math.sin(this.phase)) * 0.12 * gallop;
    this.bodyG.rotation.x = Math.sin(this.phase) * 0.06 * gallop;
    this.neck.rotation.x = -0.15 + Math.sin(this.phase + 1) * 0.12 * gallop;
    this.tail.rotation.x = 0.4 * gallop + Math.sin(this.phase * 0.5) * 0.1;
    if (speed < 0.5) this.headG.rotation.x = Math.sin(this.phase * 0.2) * 0.15 + 0.3;
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const mm of this.mats) mm.dispose();
  }
}

// ------------------------------------------------------------------ looks
export function randomLook(assets, kind, extra = {}) {
  const P = assets.json.characters.palettes;
  if (kind === 'lady') {
    const p = P.lady;
    return { kind, skin: pick(p.skin), shirt: pick(p.shirt), pants: '#3a3a3a', dress: pick(p.dress), hat: pick(p.bonnet), hatType: 'bonnet', boots: '#2a1c12', belt: '#3a2a1a', hair: '#4a2a1a', scale: rand(0.92, 0.98), ...extra };
  }
  const p = kind === 'civilian' ? P.civilian : P.outlaw;
  const hatType = kind === 'civilian' ? pick(['cowboy', 'bowler', 'bowler', 'none']) : pick(['cowboy', 'cowboy', 'cowboy', 'bowler']);
  const bandana = pick(p.bandana);
  return {
    kind, skin: pick(p.skin), shirt: pick(p.shirt), vest: pick(p.vest), coat: pick(p.coat), pants: pick(p.pants),
    hat: pick(p.hat), hatType, bandana, mask: kind === 'outlaw' && bandana && chance(0.5), boots: pick(p.boots), belt: pick(p.belt),
    mustache: chance(0.5), beard: kind === 'outlaw' && chance(0.2), hair: pick(['#1a120c', '#3a2414', '#5a3a1e', '#6a6a6a']),
    gloves: kind === 'outlaw' && chance(0.4) ? '#5a3a1e' : null,
    weapon: kind === 'civilian' ? null : 'rifle', scale: rand(0.96, 1.06), ...extra,
  };
}

// ------------------------------------------------------------------ actor
let NEXT_ID = 1;

/**
 * role: window | roof | balcony | street | runner | rider | train | sniper | hostage | boss | civilian | captive
 * cfg: { spawn, aim:[a,b], accuracy, damage, shootBack, hp, look }
 */
export class Actor {
  constructor(game, role, cfg = {}) {
    this.id = NEXT_ID++;
    this.game = game;
    this.role = role;
    this.cfg = cfg;
    this.enemy = role !== 'civilian' && role !== 'captive';
    this.alive = true;
    this.removed = false;
    this.escaped = false;
    this.hp = cfg.hp ?? 100;
    this.maxHp = this.hp;
    this.state = 'wait';
    this.stateT = 0;
    this.t = rand(0, 10);
    this.aimProgress = 0;
    this.aimTime = rand(...(cfg.aim || [3, 4]));
    this.walkPhase = rand(0, 6);
    this.speed = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.deathT = 0;
    this.exposed = false;
    this.alert = 0;
    this.boss = !!cfg.boss;
    this.relocations = 0;
    const kind = role === 'civilian' || role === 'captive' ? (cfg.lady ? 'lady' : 'civilian') : 'outlaw';
    const look = cfg.look || randomLook(game.assets, kind, {
      weapon: role === 'sniper' ? 'scoped' : role === 'rider' || role === 'hostage' ? 'revolver' : role === 'runner' ? (cfg.dynamite ? null : 'revolver') : kind === 'outlaw' ? 'rifle' : null,
      loot: role === 'runner' && !cfg.dynamite, dynamite: role === 'runner' && cfg.dynamite,
    });
    this.rig = new Rig(game.assets, look);
    this.root = this.rig.root;
    this.root.userData.actor = this;
    this.pos = this.root.position;
    this.basePose = role === 'captive' ? POSES.handsUp : POSES.stand;
    this.target = pose();
    game.world.scene.add(this.root);
    this.horse = null;
    this.anchor = null;
    this.glint = null;
  }

  get worldPos() { return this.root.getWorldPosition(_v3); }

  setState(s) { this.state = s; this.stateT = 0; }

  facePlayer(dt, speed = 6) {
    const P = this.game.world.vantage;
    const wp = this.root.getWorldPosition(_v);
    let targetYaw = Math.atan2(P.x - wp.x, P.z - wp.z);
    if (this.anchor) targetYaw -= this.anchor.parent.parent.rotation.y;
    this.yaw = angleDamp(this.yaw, targetYaw, speed, dt);
    this.root.rotation.y = this.yaw;
    const dist = Math.hypot(P.x - wp.x, P.z - wp.z);
    this.pitch = Math.atan2(P.y - (wp.y + 1.45), dist);
  }

  faceYaw(y, dt, speed = 6) {
    this.yaw = angleDamp(this.yaw, y, speed, dt);
    this.root.rotation.y = this.yaw;
  }

  distanceToPlayer() { return this.root.getWorldPosition(_v).distanceTo(this.game.world.vantage); }

  // ---------------------------------------------------------------- hit testing
  /** Segment test against head / torso / limbs. Returns { t, part } or null. */
  hitTest(o, d, len) {
    if (!this.alive || this.removed || !this.root.visible) return null;
    const center = this.rig.j.chest.getWorldPosition(_v);
    // broad phase
    if (segSphere(o, d, len, center, 1.4) < 0) return null;
    const j = this.rig.j;
    let best = null;
    const test = (t, part) => { if (t >= 0 && (!best || t < best.t)) best = { t, part }; };
    const head = j.head.getWorldPosition(_v2).add(_v3.set(0, 0.1, 0.015).applyQuaternion(j.head.getWorldQuaternion(_q)));
    test(segSphere(o, d, len, head, 0.135 * (this.rig.look.scale || 1)), 'head');
    const hips = j.hips.getWorldPosition(new THREE.Vector3());
    const neck = j.neck.getWorldPosition(new THREE.Vector3());
    test(segCapsule(o, d, len, hips, neck, 0.2), 'body');
    for (const [a, b] of [['thL', 'knL'], ['thR', 'knR']]) {
      const pa = j[a].getWorldPosition(new THREE.Vector3());
      const pb = j[b].getWorldPosition(new THREE.Vector3());
      test(segCapsule(o, d, len, pa, pb, 0.1), 'limb');
      const foot = new THREE.Vector3(0, -this.R_shin(), 0).applyMatrix4(j[b].matrixWorld);
      test(segCapsule(o, d, len, pb, foot, 0.08), 'limb');
    }
    for (const [a, b] of [['shL', 'elL'], ['shR', 'elR']]) {
      const pa = j[a].getWorldPosition(new THREE.Vector3());
      const pb = j[b].getWorldPosition(new THREE.Vector3());
      test(segCapsule(o, d, len, pa, pb, 0.08), 'limb');
    }
    if (this.horse) {
      const hb = this.horse.bodyG.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, 0.8).applyQuaternion(this.horse.root.quaternion);
      const t = segCapsule(o, d, len, hb.clone().sub(fwd), hb.clone().add(fwd), 0.45);
      if (t >= 0 && (!best || t < best.t)) best = { t, part: 'horse' };
    }
    return best;
  }
  R_shin() { return this.game.assets.json.characters.rig.shin; }

  /** Apply a bullet hit. Returns { killed, part, dmg }. */
  takeHit(hit) {
    if (!this.alive) return { killed: false };
    if (hit.part === 'horse') return { killed: false, horse: true };
    // any hit knocks a galloping rider out of the saddle
    const mult = hit.part === 'head' ? 4 : hit.part === 'body' || this.role === 'rider' ? 1 : 0.6;
    const dmg = hit.damage * mult;
    this.hp -= dmg;
    this.alert = 1;
    if (this.hp <= 0) {
      this.die(hit);
      return { killed: true, part: hit.part, dmg };
    }
    // wounded: flinch + break aim
    this.flinch = 1;
    this.aimProgress = Math.max(0, this.aimProgress - 0.6);
    if (this.boss) this.onBossWounded?.();
    else if (['window', 'roof', 'balcony', 'sniper', 'street'].includes(this.role)) this.setState('duck');
    return { killed: false, part: hit.part, dmg };
  }

  die(hit) {
    this.alive = false;
    this.exposed = false;
    this.aimProgress = 0;
    this.hideGlint();
    this.setState('dying');
    this.rig.setTint('#000000', 0);
    const dir = hit.dir ? hit.dir.clone() : new THREE.Vector3(0, 0, -1);
    dir.y = 0; dir.normalize();
    // detach from train / horse into world space
    if (this.anchor || this.horse) {
      const wp = this.root.getWorldPosition(new THREE.Vector3());
      const wq = this.root.getWorldQuaternion(new THREE.Quaternion());
      this.game.world.scene.attach(this.root);
      this.root.position.copy(wp); this.root.quaternion.copy(wq);
      this.yaw = new THREE.Euler().setFromQuaternion(wq, 'YXZ').y;
      this.root.rotation.set(0, this.yaw, 0);
      this.fallVel = new THREE.Vector3(dir.x * 2, 1.5, dir.z * 2);
      if (this.anchor && this.game.world.train) this.fallVel.x += this.game.world.train.speed * this.game.world.train.dir;
      if (this.horse) { this.fallVel.add(this.rideDir.clone().multiplyScalar(this.speed * 0.6)); this.riderless = this.horse; this.horse = null; }
      this.anchor = null;
      this.groundY = this.game.world.heightAt(wp.x, wp.z);
      this.deathMode = 'fall';
    } else if (this.role === 'window' && chance(0.75)) {
      this.deathMode = 'slump';
    } else if ((this.role === 'roof' || this.role === 'balcony') && chance(0.6)) {
      this.deathMode = 'fall';
      const out = new THREE.Vector3(Math.sin(this.spawn?.yaw ?? 0), 0, Math.cos(this.spawn?.yaw ?? 0));
      this.fallVel = out.multiplyScalar(2.2).add(new THREE.Vector3(0, 2, 0)).addScaledVector(dir, 0.8);
      const land = this.root.position.clone().addScaledVector(out.normalize(), 2.2);
      const rc = this.game.world.raycast(land.clone().setY(land.y + 0.5), new THREE.Vector3(0, -1, 0), 60);
      this.groundY = rc ? rc.point.y : this.game.world.heightAt(land.x, land.z);
    } else {
      this.deathMode = 'topple';
    }
    // fall direction: along bullet, expressed in local space for the pivot
    const localDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.fallAxis = new THREE.Vector3(localDir.z, 0, -localDir.x).normalize();
    if (this.deathMode === 'slump') {
      // fold forward over the sill (towards the street = local +Z)
      this.fallAxis.set(1, 0, 0);
      this.rig.pivot.position.y = 0.95; this.rig.body.position.y = -0.95;
      this.fallMax = rand(1.0, 1.3);
    } else {
      this.fallMax = Math.PI / 2 - 0.05;
    }
    this.fallAngle = 0; this.fallSpeed = 0;
    this.deathPose = pose({
      hipY: this.deathMode === 'slump' ? -0.05 : rand(-0.25, -0.05),
      spine: [rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.2, 0.2)], neck: [rand(-0.5, 0.5), rand(-0.6, 0.6), 0],
      shL: [rand(-2.6, 0.4), 0, rand(0.2, 1.6)], shR: [rand(-2.6, 0.4), 0, rand(-1.6, -0.2)], elL: [rand(-1.6, 0), 0, 0], elR: [rand(-1.6, 0), 0, 0],
      thL: [rand(-0.8, 0.2), 0, rand(0, 0.4)], thR: [rand(-0.8, 0.2), 0, rand(-0.4, 0)], knL: [rand(0, 1.2), 0, 0], knR: [rand(0, 1.2), 0, 0],
    });
    if (hit.part === 'head' && this.rig.hat) this.launchHat(dir);
    if (this.weapon && chance(0.6)) this.dropWeapon = true;
    if (this.role === 'captive' || this.role === 'civilian') this.game.mission?.onCivilianDown?.(this);
  }

  launchHat(dir) {
    const hat = this.rig.hat;
    const wp = hat.getWorldPosition(new THREE.Vector3());
    const wq = hat.getWorldQuaternion(new THREE.Quaternion());
    this.game.world.scene.attach(hat);
    hat.position.copy(wp); hat.quaternion.copy(wq);
    this.hatVel = dir.clone().multiplyScalar(rand(2.5, 4)).add(new THREE.Vector3(0, rand(2.5, 4), 0));
    this.hatSpin = new THREE.Vector3(rand(-8, 8), rand(-12, 12), rand(-8, 8));
    const rc = this.game.world.raycast(wp.clone().addScaledVector(dir, 1.5).setY(wp.y + 1), new THREE.Vector3(0, -1, 0), 80);
    this.hatGround = rc ? rc.point.y + 0.02 : this.game.world.heightAt(wp.x, wp.z);
    this.flyingHat = hat;
    this.rig.hat = null;
  }

  showGlint(strength) {
    if (!this.rig.glintLocal) return;
    if (!this.glint) {
      this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.game.assets.tex('glint'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
      this.glint.renderOrder = 5;
      this.game.world.scene.add(this.glint);
    }
    const p = this.rig.glintLocal.clone().applyMatrix4(this.rig.weapon.matrixWorld);
    this.glint.position.copy(p);
    const dist = p.distanceTo(this.game.world.vantage);
    this.glint.scale.setScalar(dist * 0.012 * (0.6 + strength) * (0.8 + Math.sin(this.t * 25) * 0.2));
    this.glint.material.opacity = clamp(strength, 0, 1);
    this.glint.visible = true;
  }
  hideGlint() { if (this.glint) this.glint.visible = false; }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.root.parent?.remove(this.root);
    if (this.flyingHat) this.flyingHat.parent?.remove(this.flyingHat);
    if (this.glint) { this.glint.parent?.remove(this.glint); this.glint.material.dispose(); }
    if (this.horse) { this.horse.root.parent?.remove(this.horse.root); this.horse.dispose(); }
    if (this.riderless) { this.riderless.root.parent?.remove(this.riderless.root); this.riderless.dispose(); }
    this.rig.dispose();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.removed) return;
    this.t += dt;
    this.stateT += dt;
    this.alert = Math.max(0, this.alert - dt * 0.3);
    this.flinch = Math.max(0, (this.flinch || 0) - dt * 3);
    if (!this.alive) { this.updateDeath(dt); return; }
    const fn = BEHAVIOURS[this.role] || BEHAVIOURS.window;
    fn(this, dt);
    if (this.removed || !this.alive) return;
    // compose pose
    const p = copyPose(this.target, this.basePose);
    if (this.moving) locomotion(p, this.walkPhase, 1, this.running);
    if (this.aiming) {
      const src = this.rig.weaponMode === 'pistol' ? (this.horse ? POSES.rideAim : POSES.aimPistol) : this.crouched ? POSES.crouchAim : POSES.aimRifle;
      blendInto(p, src, 1);
      p.chest[0] = -this.pitch * 0.9;
      if (this.rig.weaponMode === 'pistol') p.shR[0] += -this.pitch;
    } else if (this.crouched) blendInto(p, POSES.crouch, 1);
    if (this.horse && !this.aiming) blendInto(p, POSES.ride, 1);
    // breathing + idle sway
    p.chest[0] += Math.sin(this.t * 1.7) * 0.02;
    p.head[1] += this.aiming ? 0 : Math.sin(this.t * 0.6) * 0.25 * (this.looking ? 1 : 0.3);
    if (this.flinch > 0) { p.spine[0] -= this.flinch * 0.4; p.head[0] -= this.flinch * 0.3; }
    this.rig.apply(p, dt, this.moving ? 14 : 9);
    if (this.horse) this.horse.update(dt, this.speed);
    // dead-eye highlight
    const de = this.game.combat?.deadEye;
    if (this.enemy) this.rig.setTint('#ff2a10', de ? 0.35 + Math.sin(this.t * 8) * 0.1 : 0);
  }

  updateDeath(dt) {
    this.deathT += dt;
    const r = this.rig;
    r.apply(this.deathPose, dt, 7);
    if (this.deathMode === 'fall' && this.fallVel) {
      this.fallVel.y -= 9.8 * dt;
      this.root.position.addScaledVector(this.fallVel, dt);
      this.fallSpeed += dt * 5;
      this.fallAngle = Math.min(Math.PI / 2 - 0.05, this.fallAngle + this.fallSpeed * dt);
      if (this.root.position.y <= this.groundY) {
        this.root.position.y = this.groundY;
        if (!this.landed) {
          this.landed = true;
          this.game.world.fx.impact(this.root.position.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3(0, 1, 0), 'dirt');
          this.game.audio.play('impact_dirt', { distance: this.distanceToPlayer(), volume: 0.8 });
        }
        this.fallVel.set(0, 0, 0);
      }
    } else {
      this.fallSpeed += dt * (this.deathMode === 'slump' ? 4 : 6);
      this.fallAngle = Math.min(this.fallMax, this.fallAngle + this.fallSpeed * dt * easeInQuad(Math.min(1, this.deathT * 2 + 0.3)));
      if (this.fallAngle >= this.fallMax && !this.landed) {
        this.landed = true;
        if (this.deathMode === 'topple') this.game.world.fx.impact(this.root.position.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), 'dirt');
      }
    }
    r.pivot.quaternion.setFromAxisAngle(this.fallAxis, this.fallAngle);
    if (this.flyingHat && this.hatVel) {
      this.hatVel.y -= 9.8 * dt;
      this.flyingHat.position.addScaledVector(this.hatVel, dt);
      this.flyingHat.rotation.x += this.hatSpin.x * dt; this.flyingHat.rotation.y += this.hatSpin.y * dt; this.flyingHat.rotation.z += this.hatSpin.z * dt;
      if (this.flyingHat.position.y <= this.hatGround) {
        this.flyingHat.position.y = this.hatGround;
        this.flyingHat.rotation.set(0, this.flyingHat.rotation.y, 0);
        this.hatVel = null;
      }
    }
    if (this.riderless) {
      this.riderless.update(dt, 11);
      this.riderless.root.position.addScaledVector(this.rideDir, 11 * dt);
      if (Math.abs(this.riderless.root.position.x) > 260) { this.riderless.root.parent?.remove(this.riderless.root); this.riderless.dispose(); this.riderless = null; }
    }
    if (this.deathT > 45) this.remove();
  }

  // ---------------------------------------------------------------- combat
  fire() {
    const g = this.game;
    const wp = this.rig.muzzleWorld(new THREE.Vector3());
    const P = g.world.vantage;
    const dir = P.clone().sub(wp).normalize();
    g.world.fx.muzzle(wp, dir, this.role === 'sniper' ? 1.2 : 0.9);
    const dist = wp.distanceTo(P);
    g.audio.play('enemy_shot', { distance: dist, volume: this.role === 'sniper' ? 1 : 0.85, pan: clamp((wp.x - P.x) / 80, -0.8, 0.8) });
    const acc = (this.cfg.accuracy ?? 0.5) * clamp(1.25 - dist / 380, 0.55, 1.1) * (this.flinch > 0 ? 0.5 : 1);
    const hit = Math.random() < acc;
    g.combat?.onEnemyShot(this, hit, wp, dist);
    this.fired = (this.fired || 0) + 1;
  }
}

const _q = new THREE.Quaternion();

function copyPose(dst, src) {
  dst.hipY = src.hipY;
  for (const j of JOINTS) { dst[j][0] = src[j][0]; dst[j][1] = src[j][1]; dst[j][2] = src[j][2]; }
  return dst;
}
function blendInto(dst, src, w) {
  dst.hipY = lerp(dst.hipY, src.hipY, w);
  for (const j of JOINTS) for (let i = 0; i < 3; i++) dst[j][i] = lerp(dst[j][i], src[j][i], w);
}
function angleDamp(a, b, lambda, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}

// ------------------------------------------------------------------ behaviours
function moveTowards(a, target, speed, dt) {
  const wp = a.root.position;
  _v.subVectors(target, wp);
  const flat = Math.hypot(_v.x, _v.z);
  if (flat < 0.05 && Math.abs(_v.y) < 0.05) { a.moving = false; return true; }
  const step = Math.min(flat, speed * dt);
  if (flat > 0.001) {
    wp.x += (_v.x / flat) * step; wp.z += (_v.z / flat) * step;
    a.faceYaw(Math.atan2(_v.x, _v.z), dt, 10);
  }
  wp.y = lerp(wp.y, target.y, clamp(dt * 10, 0, 1));
  a.moving = true;
  a.walkPhase += dt * speed * (a.running ? 3.2 : 4.2);
  return flat - step < 0.05;
}

// Shared aim → fire loop. Returns true when a shot was just fired.
function aimLoop(a, dt, mult = 1) {
  a.aiming = true;
  a.facePlayer(dt);
  if (!a.cfg.shootBack) { a.aimProgress = 0; return false; }
  a.aimProgress += dt / (a.aimTime * mult);
  if (a.role === 'sniper') a.showGlint(0.3 + a.aimProgress * 0.9);
  if (a.aimProgress >= 1) {
    a.fire();
    a.aimProgress = 0;
    a.aimTime = rand(...(a.cfg.aim || [3, 4])) * (a.fired > 1 ? 0.85 : 1);
    a.hideGlint();
    return true;
  }
  return false;
}

const BEHAVIOURS = {
  // Pops up in a window / on a roof / sniper perch: hidden → emerge → aim → fire → duck
  window(a, dt) {
    const sp = a.spawn;
    switch (a.state) {
      case 'wait':
        a.root.position.copy(sp.hidden); a.crouched = a.role === 'roof' || a.role === 'sniper'; a.aiming = false; a.exposed = false;
        a.root.rotation.y = a.yaw = sp.yaw;
        if (a.stateT > (a.delay ?? rand(0.5, 2))) { a.setState('emerge'); a.delay = undefined; }
        break;
      case 'emerge': {
        const k = clamp(a.stateT / 0.9, 0, 1);
        a.root.position.lerpVectors(sp.hidden, sp.pos, k);
        a.crouched = (a.role === 'roof' || a.role === 'sniper') && k < 0.5;
        a.moving = a.role === 'window' && k < 1;
        a.walkPhase += dt * 4;
        a.facePlayer(dt, 3);
        if (k >= 1) { a.moving = false; a.setState(a.cfg.shootBack ? 'aim' : 'look'); a.exposed = true; }
        break;
      }
      case 'look':
        a.exposed = true; a.aiming = false; a.looking = true;
        a.faceYaw(sp.yaw + Math.sin(a.t * 0.5) * 0.8, dt, 2);
        if (a.stateT > rand(4, 7) && chance(dt * 0.5)) a.setState('duck');
        break;
      case 'aim':
        a.exposed = true; a.looking = false;
        if (aimLoop(a, dt, a.role === 'sniper' ? 1.15 : 1)) a.setState('recover');
        break;
      case 'recover':
        a.aiming = true;
        a.facePlayer(dt);
        if (a.stateT > 0.7) a.setState(chance(0.45) ? 'duck' : 'aim');
        break;
      case 'duck': {
        a.aiming = false; a.exposed = false; a.hideGlint();
        const k = clamp(a.stateT / 0.6, 0, 1);
        a.root.position.lerpVectors(sp.pos, sp.hidden, k);
        a.crouched = a.role === 'roof' || a.role === 'sniper';
        if (k >= 1) { a.delay = rand(1.2, 3); a.setState('wait'); }
        break;
      }
    }
  },
  roof(a, dt) { BEHAVIOURS.window(a, dt); },
  sniper(a, dt) { BEHAVIOURS.window(a, dt); },

  // Steps out of the balcony door, then patrols between two points between shots.
  balcony(a, dt) {
    const sp = a.spawn;
    switch (a.state) {
      case 'wait':
        a.root.position.copy(sp.hidden); a.exposed = false; a.aiming = false;
        if (a.stateT > (a.delay ?? rand(0.5, 2))) { a.setState('walk'); a.delay = undefined; a.walkTarget = pick(sp.walk || [sp.pos]); }
        break;
      case 'walk':
        a.exposed = true; a.aiming = false; a.running = false;
        if (moveTowards(a, a.walkTarget, 1.6, dt)) a.setState(a.cfg.shootBack ? 'aim' : 'look');
        break;
      case 'look':
        a.moving = false; a.looking = true;
        a.faceYaw(sp.yaw, dt, 2);
        if (a.stateT > rand(2.5, 4)) { a.walkTarget = pick(sp.walk || [sp.pos]); a.setState('walk'); }
        break;
      case 'aim':
        a.moving = false;
        if (aimLoop(a, dt)) a.setState('recover');
        break;
      case 'recover':
        a.facePlayer(dt);
        if (a.stateT > 0.8) {
          if (chance(0.5)) { a.walkTarget = pick(sp.walk || [sp.pos]); a.setState('walk'); } else a.setState('aim');
        }
        break;
      case 'duck':
        a.aiming = false; a.running = true;
        if (moveTowards(a, sp.hidden, 3, dt)) { a.delay = rand(1.5, 3); a.setState('wait'); a.running = false; }
        break;
    }
  },

  // Exits a door, runs to street cover, pops up to shoot, occasionally relocates.
  street(a, dt) {
    const g = a.game;
    switch (a.state) {
      case 'wait':
        a.root.position.copy(a.door.hidden); a.exposed = false;
        if (a.stateT > (a.delay ?? rand(0.3, 1.5))) { a.delay = undefined; a.setState('exit'); }
        break;
      case 'exit':
        a.running = false; a.exposed = true;
        if (moveTowards(a, a.door.pos, 2.2, dt)) a.setState('toCover');
        break;
      case 'toCover':
        a.running = true; a.exposed = true; a.aiming = false; a.crouched = false;
        if (moveTowards(a, a.cover.pos, 4.6, dt)) { a.running = false; a.setState('hide'); }
        break;
      case 'hide':
        a.moving = false; a.crouched = true; a.aiming = false; a.exposed = a.cover.coverHeight < 1.2;
        a.faceYaw(a.cover.yaw, dt, 4);
        if (a.stateT > (a.hideTime ??= rand(1.2, 2.8))) {
          a.hideTime = undefined;
          if (a.relocations < 2 && chance(0.25)) {
            const next = g.mission.claimCover(a);
            if (next) { a.relocations++; a.setState('toCover'); break; }
          }
          a.setState(a.cfg.shootBack ? 'aim' : 'peek');
        }
        break;
      case 'peek':
        a.crouched = false; a.exposed = true; a.looking = true;
        a.faceYaw(a.cover.yaw + Math.sin(a.t) * 0.6, dt, 3);
        if (a.stateT > rand(2.5, 4)) a.setState('hide');
        break;
      case 'aim':
        a.crouched = false;
        a.exposed = true;
        if (aimLoop(a, dt)) a.setState('recover');
        break;
      case 'recover':
        a.facePlayer(dt);
        if (a.stateT > 0.6) a.setState('hide');
        break;
      case 'duck':
        a.setState('hide');
        break;
    }
  },

  // Dashes from a door to an exit at the end of the street.
  runner(a, dt) {
    switch (a.state) {
      case 'wait':
        a.root.position.copy(a.door.hidden); a.exposed = false;
        if (a.stateT > (a.delay ?? rand(0.2, 1))) { a.delay = undefined; a.setState('exit'); }
        break;
      case 'exit':
        a.running = true; a.exposed = true;
        if (moveTowards(a, a.door.pos, 4, dt)) a.setState('street');
        break;
      case 'street':
        a.running = true;
        if (moveTowards(a, a.streetPoint, 5.2, dt)) a.setState('flee');
        break;
      case 'flee': {
        a.running = true;
        const tgt = a.exitPoint;
        if (a.cfg.shootBack && !a.shotOnce && a.stateT > 1.2 && chance(dt * 0.25)) { a.shotOnce = true; a.setState('stopShoot'); break; }
        if (moveTowards(a, tgt, a.runSpeed, dt)) { a.escaped = true; a.alive = false; a.exposed = false; a.game.mission.onEscape(a); a.remove(); }
        break;
      }
      case 'stopShoot':
        a.moving = false; a.running = false;
        if (aimLoop(a, dt, 0.6)) a.setState('flee');
        break;
      case 'duck':
        a.setState('flee');
        break;
    }
  },

  // Gallops along the street; may fire a revolver mid-ride.
  rider(a, dt) {
    const h = a.horse;
    switch (a.state) {
      case 'wait':
        h.root.visible = false; a.root.visible = false;
        if (a.stateT > (a.delay ?? 0.5)) { a.delay = undefined; h.root.visible = true; a.root.visible = true; a.setState('ride'); }
        break;
      case 'ride':
      case 'duck': {
        a.exposed = true;
        a.speed = damp(a.speed, a.rideSpeed, 2, dt);
        h.root.position.addScaledVector(a.rideDir, a.speed * dt);
        h.root.position.y = a.game.world.heightAt(h.root.position.x, h.root.position.z);
        const midway = Math.abs(h.root.position.x) < 60;
        if (a.cfg.shootBack && midway && !a.shotOnce) {
          a.aiming = true;
          a.facePlayer(dt, 8);
          // aim in horse-local yaw
          a.root.rotation.y = a.yaw - h.root.rotation.y;
          if (aimLoop(a, dt, 0.7)) { a.shotOnce = true; a.aiming = false; }
          a.root.rotation.y = a.yaw - h.root.rotation.y;
        } else {
          a.aiming = false;
          a.root.rotation.y = 0; a.yaw = h.root.rotation.y;
        }
        if (Math.abs(h.root.position.x) > Math.abs(a.exitX)) { a.escaped = true; a.alive = false; a.exposed = false; a.game.mission.onEscape(a); a.remove(); }
        break;
      }
    }
  },

  // Rides the train roof; crouches and pops up to shoot.
  train(a, dt) {
    const tr = a.game.world.train;
    if (tr && !tr.active && a.stateT > 1) { a.escaped = true; a.alive = false; a.exposed = false; a.game.mission.onEscape(a); a.remove(); return; }
    a.exposed = true;
    switch (a.state) {
      case 'wait':
        a.crouched = true; a.aiming = false;
        if (a.stateT > (a.delay ?? rand(1, 3))) { a.delay = undefined; a.setState('aim'); }
        break;
      case 'aim':
        a.crouched = false;
        if (aimLoop(a, dt)) a.setState('recover');
        break;
      case 'recover':
        a.facePlayer(dt);
        if (a.stateT > 0.6) { a.setState('wait'); a.delay = rand(1, 2.5); }
        break;
      case 'duck':
        a.setState('wait'); a.delay = rand(1, 2);
        break;
    }
  },

  // Holds a captive at gunpoint; executes them when the timer expires.
  hostage(a, dt) {
    const c = a.captive;
    a.exposed = true;
    a.aiming = false;
    a.basePose = POSES.holdHostage;
    a.timer -= dt;
    // sway side to side behind the captive
    const sway = Math.sin(a.t * 0.9) * 0.35;
    const right = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    a.root.position.copy(a.spawn.pos).addScaledVector(right, sway);
    a.facePlayer(dt, 2);
    if (c && c.alive) {
      const fwd = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
      // captive is held in front and to the side, so the taker's head stays exposed as he sways
      c.root.position.copy(a.root.position).addScaledVector(fwd, 0.38).addScaledVector(right, -0.3 - sway * 0.4);
      c.yaw = a.yaw; c.root.rotation.y = a.yaw;
    }
    if (a.timer <= 0 && c && c.alive) {
      const wp = a.rig.muzzleWorld(new THREE.Vector3());
      a.game.world.fx.muzzle(wp, new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), 0.7);
      a.game.audio.play('enemy_shot', { distance: a.distanceToPlayer() });
      c.die({ part: 'head', dir: new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), damage: 999 });
      a.game.mission.onHostageExecuted(a);
      a.captive = null;
      a.role = 'street';
      a.cover = a.game.mission.claimCover(a) || { pos: a.root.position.clone(), yaw: a.yaw, coverHeight: 1 };
      a.basePose = POSES.stand;
      a.cfg.shootBack = true;
      a.relocations = 0;
      a.setState('toCover');
    }
  },

  // Bystanders stroll the boardwalk and flee when shooting starts.
  civilian(a, dt) {
    const g = a.game;
    a.exposed = false;
    if (a.lane && a.state !== 'flee' && a.state !== 'freed' && g.mission?.panic > 0 && a.stateT > 0.3) { a.setState('flee'); a.fleeX = a.root.position.x < 0 ? a.lane.x0 - 30 : a.lane.x1 + 30; }
    switch (a.state) {
      case 'wait':
      case 'walk': {
        a.running = false;
        const tgt = _v2.set(a.walkX, a.lane.y + g.world.heightAt(a.walkX, a.lane.z), a.lane.z);
        if (moveTowards(a, tgt, 1.25, dt)) { a.setState('idle'); a.idleTime = rand(1, 4); }
        break;
      }
      case 'idle':
        a.moving = false; a.looking = true;
        if (a.stateT > a.idleTime) { a.walkX = rand(a.lane.x0, a.lane.x1); a.setState('walk'); }
        break;
      case 'flee': {
        a.running = true;
        a.basePose = POSES.stand;
        const tgt = _v2.set(a.fleeX, g.world.heightAt(a.fleeX, a.lane.z) + (Math.abs(a.fleeX) < Math.abs(a.lane.x1) ? a.lane.y : 0), a.lane.z);
        if (moveTowards(a, tgt, 5, dt)) a.remove();
        break;
      }
      case 'freed': {
        a.running = true;
        a.basePose = POSES.stand;
        const tgt = _v2.set(a.root.position.x < 0 ? -200 : 200, 0, a.root.position.z);
        tgt.y = g.world.heightAt(tgt.x, tgt.z);
        if (moveTowards(a, tgt, 5, dt) || a.stateT > 12) a.remove();
        break;
      }
    }
  },
  captive(a, dt) { a.exposed = false; if (a.state === 'freed') BEHAVIOURS.civilian(a, dt); },

  // Wanted boss: pops up across several vantage points, relocating when wounded.
  boss(a, dt) {
    if (!a.onBossWounded) {
      a.onBossWounded = () => { a.relocate = true; a.setState('duck'); a.game.mission.onBossWounded(a); };
    }
    if (a.state === 'wait' && a.relocate) {
      a.relocate = false;
      const next = a.game.mission.bossNextSpawn(a);
      if (next) { a.spawn.occupied = false; a.spawn = next; next.occupied = true; a.delay = rand(1.5, 2.5); }
    }
    BEHAVIOURS.window(a, dt);
  },
};

export function makeHorseAt(game, pos, yaw) {
  const h = new Horse(game.assets);
  h.root.position.copy(pos);
  h.root.rotation.y = yaw;
  game.world.scene.add(h.root);
  return h;
}

export { POSES };
