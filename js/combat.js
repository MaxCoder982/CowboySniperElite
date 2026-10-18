// combat.js — the player: camera/aim, scope & sway, breath, ballistics (drop + wind + pierce),
// explosive barrels, Dead-Eye slow-mo, cinematic bullet cam, first-person rifle view-model,
// health/damage feedback and the intro fly-in.
import * as THREE from 'three';
import { clamp, lerp, damp, rand, noise1, chance, easeInOutSine, easeOutCubic } from './core.js';

export const GRAVITY = 6.0;       // tuned for readable bullet drop at 100-300 m
export const WIND_ACCEL = 1.2;    // lateral acceleration per m/s of wind

const _fwd = new THREE.Vector3(), _tmp = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Combat {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.yaw = 0; this.pitch = -0.1;
    this.bullets = [];
    this.mode = 'idle';
    // view-model scene (rendered on top, never clips into the world)
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(48, 1, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight('#ffffff', '#886644', 1.2);
    this.vmSun = new THREE.DirectionalLight('#ffffff', 2.4);
    this.vmSun.position.set(1, 2, 1);
    this.vmScene.add(this.vmHemi, this.vmSun);
    this.vmRoot = new THREE.Group();
    this.vmScene.add(this.vmRoot);
    this.vmRifle = null;
    this.bulletMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.04, 4, 8), new THREE.MeshStandardMaterial({ color: '#c8963c', metalness: 1, roughness: 0.25, emissive: '#3a2410' }));
    this.bulletMesh.rotation.x = Math.PI / 2;
    this.bulletTrail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.014, 3, 6, 1, true), new THREE.MeshBasicMaterial({ color: '#fff4e0', transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.bulletTrail.rotation.x = Math.PI / 2;
    this.bulletTrail.position.z = -1.6;
    this.bulletObj = new THREE.Group();
    this.bulletObj.add(this.bulletMesh, this.bulletTrail);
    this.bulletObj.visible = false;
    game.world.scene.add(this.bulletObj);
  }

  get settings() { return this.game.profile.settings; }

  // ---------------------------------------------------------------- setup
  reset(contract) {
    const p = this.game.profile;
    this.rifle = p.rifle();
    const up = (id) => p.upgradeValue(id);
    this.stability = clamp(up('stability'), 0, 0.7);
    this.breathMax = 3.2 + up('breath');
    this.reloadMult = 1 - up('reload');
    this.armor = up('armor');
    this.deadEyeMax = 4 + up('deadeye') * 10 * 0.6;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.mag = this.rifle.mag;
    this.reserve = contract.showdown ? 10 : Math.max(0, (contract.ammo || 12) + Math.round(up('bandolier')) - this.rifle.mag);
    this.zoomIndex = 0;
    this.scoped = false; this.scopeT = 0; this.zoomChanged = false;
    this.breath = 1; this.holdingBreath = false; this.breathLocked = false; this.breathPenalty = 0;
    this.boltT = 0; this.reloadT = 0; this.reloading = false;
    this.deadEye = false; this.deadEyeMeter = contract.tutorial ? 0 : 0.35; this.deadEyeT = 0;
    this.bulletCam = null; this.slowmo = 1;
    this.shake = 0; this.recoil = 0; this.lastHurt = 99; this.hurtFlash = 0;
    this.bullets.length = 0;
    this.yaw = 0; this.pitch = -0.13;
    this.outOfAmmoT = 0;
    this.rangefinder = 0; this.rangeT = 0;
    this.buildViewModel();
    this.applyFov(true);
  }

  buildViewModel() {
    if (this.vmRifle) this.vmRoot.remove(this.vmRifle);
    const A = this.game.assets;
    const g = A.build(this.rifle.model, 'rifles', { castShadow: false, receiveShadow: false });
    // gloved hands + sleeves holding the rifle
    const glove = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.7 });
    const sleeve = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.95, map: A.tex('cloth') });
    const hand = (x, y, z, rx) => {
      const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.06, 4, 8), glove);
      h.position.set(x, y, z); h.rotation.x = rx; h.scale.set(1, 1, 1.2);
      g.add(h);
      const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), sleeve);
      s.position.set(x + (x > 0 ? 0.06 : 0.1), y - 0.12, z + 0.2);
      s.rotation.set(rx + 0.9, 0, x > 0 ? 0.5 : -0.2);
      g.add(s);
    };
    hand(0.01, -0.06, -0.38, 0.4);
    hand(-0.01, -0.07, 0.12, -0.3);
    this.vmRifle = g;
    this.vmParts = g.userData.parts;
    this.vmMuzzle = new THREE.Vector3(...(g.userData.def.muzzle || [0, 0, -1]));
    this.vmRoot.add(g);
  }

  applyFov(instant) {
    const base = this.settings.fov;
    const zoom = this.rifle.zoom[this.zoomIndex];
    const target = lerp(base, base / zoom, easeOutCubic(this.scopeT));
    this.camera.fov = instant ? base : target;
    this.camera.updateProjectionMatrix();
  }

  get zoom() { return this.rifle.zoom[this.zoomIndex]; }

  // ---------------------------------------------------------------- intro
  startIntro() {
    this.mode = 'intro';
    this.introT = 0;
    const W = this.game.world;
    this.introFrom = new THREE.Vector3(rand(-60, 60), 42, -150);
    this.introLook = new THREE.Vector3(0, 4, -86);
    this.introTo = W.vantage.clone();
  }

  updateIntro(dt) {
    this.introT += dt;
    const k = clamp(this.introT / 3.6, 0, 1);
    const e = easeInOutSine(k);
    const cam = this.camera;
    const mid = this.introFrom.clone().lerp(this.introTo, 0.5).add(new THREE.Vector3(0, 18, 20));
    // quadratic bezier
    const a = this.introFrom.clone().lerp(mid, e), b = mid.clone().lerp(this.introTo, e);
    cam.position.copy(a.lerp(b, e));
    const lookA = this.introLook;
    _fwd.set(0, 0, -1).applyEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    const lookB = this.introTo.clone().addScaledVector(_fwd, 50);
    cam.lookAt(lookA.clone().lerp(lookB, easeInOutSine(clamp((k - 0.35) / 0.65, 0, 1))));
    this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix();
    if (k >= 1) { this.mode = 'play'; this.game.onIntroDone(); }
  }

  // ---------------------------------------------------------------- input + update
  get timeScale() {
    if (this.bulletCam) return this.bulletCam.phase === 'flight' ? 0.06 : 0.14;
    if (this.deadEye) return 0.32;
    return 1;
  }

  update(dt, realDt) {
    if (this.mode === 'intro') { this.updateIntro(realDt); return; }
    if (this.mode !== 'play') return;
    const g = this.game, inp = g.input, S = this.settings;
    this.updateBullets(dt);
    if (this.bulletCam) { this.updateBulletCam(dt, realDt); return; }

    // --- scope
    const scopeKey = inp.isDown('ShiftLeft', 'ShiftRight') || inp.mouse.right;
    if (S.holdToScope) this.wantScope = scopeKey;
    else if (inp.mouse.rightPressed || inp.wasPressed('ShiftLeft', 'ShiftRight')) this.wantScope = !this.wantScope;
    const canScope = !this.reloading;
    if (this.wantScope && canScope && !this.scoped) { this.scoped = true; g.audio.play('scope_in', { volume: 0.6 }); }
    if ((!this.wantScope || !canScope) && this.scoped) { this.scoped = false; g.audio.play('scope_out', { volume: 0.5 }); }
    this.scopeT = clamp(this.scopeT + (this.scoped ? 1 : -1) * realDt / 0.16, 0, 1);
    if (this.scoped && (inp.mouse.wheel || inp.wasPressed('KeyQ', 'KeyE'))) {
      const dir = inp.mouse.wheel ? -Math.sign(inp.mouse.wheel) : inp.wasPressed('KeyE') ? 1 : -1;
      const ni = clamp(this.zoomIndex + dir, 0, this.rifle.zoom.length - 1);
      if (ni !== this.zoomIndex) { this.zoomIndex = ni; this.zoomChanged = true; g.audio.play('ui_click', { volume: 0.4, rate: 1.6 }); }
    }
    this.applyFov();

    // --- aim (mouse + keyboard)
    const zoom = lerp(1, this.zoom, this.scopeT);
    const sens = 0.0021 * S.sensitivity * (this.scopeT > 0.5 ? S.scopeSensitivity * 1.25 / zoom : 1);
    this.yaw -= inp.mouse.dx * sens;
    this.pitch -= inp.mouse.dy * sens * (S.invertY ? -1 : 1);
    const kx = (inp.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (inp.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (inp.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (inp.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    this.yaw -= kx * realDt * 0.9 / zoom;
    this.pitch += ky * realDt * 0.7 / zoom;
    this.yaw = clamp(this.yaw, -1.15, 1.15);
    this.pitch = clamp(this.pitch, -0.62, 0.32);

    // --- breath
    const wantBreath = inp.isDown('Space') && this.scoped;
    if (wantBreath && !this.breathLocked && this.breath > 0) {
      if (!this.holdingBreath) g.audio.play('breath_in', { volume: 0.5 });
      this.holdingBreath = true;
      this.breath -= realDt / this.breathMax;
      if (this.breath <= 0) { this.breath = 0; this.breathLocked = true; this.holdingBreath = false; this.breathPenalty = 2; g.audio.play('breath_out', { volume: 0.7 }); }
    } else {
      if (this.holdingBreath) g.audio.play('breath_out', { volume: 0.45 });
      this.holdingBreath = false;
      this.breath = Math.min(1, this.breath + realDt / 4);
      if (this.breathLocked && this.breath > 0.4) this.breathLocked = false;
    }
    this.breathPenalty = Math.max(0, this.breathPenalty - realDt);

    // --- dead-eye
    if (inp.wasPressed('KeyF') && !this.deadEye && this.deadEyeMeter >= 0.3) {
      this.deadEye = true; this.deadEyeT = this.deadEyeMax * this.deadEyeMeter;
      g.audio.play('deadeye', { ignoreSlowmo: true });
      g.ui.flash('deadeye');
    } else if (inp.wasPressed('KeyF') && this.deadEye) {
      this.deadEye = false;
    }
    if (this.deadEye) {
      this.deadEyeT -= realDt;
      this.deadEyeMeter = Math.max(0, this.deadEyeT / this.deadEyeMax);
      if (this.deadEyeT <= 0) this.deadEye = false;
    }

    // --- weapon state
    if (this.boltT > 0) {
      this.boltT -= dt;
      if (this.boltT <= 0 && this.mag === 0) this.startReload();
    }
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.rifle.mag - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take; this.reserve -= take;
        this.reloading = false;
      }
    }
    if (inp.wasPressed('KeyR') && !this.reloading && this.mag < this.rifle.mag && this.reserve > 0) this.startReload();
    if (inp.mouse.leftPressed) this.tryFire();

    // out of ammo
    if (this.mag === 0 && this.reserve === 0 && !this.reloading && this.bullets.length === 0) {
      this.outOfAmmoT += realDt;
      if (this.outOfAmmoT > 2.2) g.mission.onOutOfAmmo();
    } else this.outOfAmmoT = 0;

    // --- health regen & low-health audio
    this.lastHurt += dt;
    if (this.lastHurt > 5 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + dt * 4);
    this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 1.5);
    const low = 1 - this.health / this.maxHealth;
    g.audio.setMuffle(this.deadEye ? 0.55 : Math.max(0, low - 0.5) * 1.2 + this.hurtFlash * 0.4);
    this.heartT = (this.heartT || 0) - realDt;
    if (this.health < 35 && this.heartT <= 0) { g.audio.play('heartbeat', { volume: 0.8, ignoreSlowmo: true }); this.heartT = 1.1; }

    // --- camera
    this.recoil = damp(this.recoil, 0, 7, realDt);
    this.shake = damp(this.shake, 0, 5, realDt);
    const t = performance.now() / 1000;
    const swayScale = this.deadEye ? 0.05 : (this.holdingBreath ? 0.14 : 1) * (1 + this.breathPenalty * 0.8) * (1 + low * 0.6);
    const amp = this.rifle.sway * (1 - this.stability) * lerp(0.0016, 0.0042, this.scopeT) * swayScale;
    const sx = (noise1(t * 0.55) * 0.8 + Math.sin(t * 1.15) * 0.45) * amp;
    const sy = (noise1(t * 0.47 + 50) * 0.7 + Math.sin(t * 0.85 + 1) * 0.35 + Math.sin(t * 0.3) * 0.3) * amp;
    const shx = (Math.random() - 0.5) * this.shake * 0.03, shy = (Math.random() - 0.5) * this.shake * 0.03;
    this.swayX = sx; this.swayY = sy;
    const cam = this.camera;
    cam.position.copy(g.world.vantage);
    cam.rotation.set(this.pitch + sy + this.recoil * 0.05 + shy, this.yaw + sx + shx, 0, 'YXZ');
    this.updateViewModel(realDt, t);

    // rangefinder
    this.rangeT -= realDt;
    if (this.rangeT <= 0) {
      this.rangeT = 0.12;
      cam.getWorldDirection(_fwd);
      const hit = g.world.raycast(cam.position, _fwd, 1500);
      let d = hit ? hit.distance : 0;
      for (const a of g.mission.actors) { const h = a.hitTest(cam.position, _fwd, d || 1500); if (h && (!d || h.t < d)) d = h.t; }
      this.rangefinder = d;
    }
  }

  startReload() {
    if (this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = this.rifle.reloadTime * this.reloadMult;
    this.game.audio.play('reload', { volume: 0.8, rate: 2.6 / this.reloadT * 0.45 + 0.55 });
  }

  addAmmo(n) { this.reserve += n; }

  tryFire() {
    const g = this.game;
    if (this.reloading || this.boltT > 0) return;
    if (this.mag <= 0) {
      g.audio.play('dry_fire', { volume: 0.8 });
      if (this.reserve > 0) this.startReload();
      return;
    }
    this.mag--;
    const cam = this.camera;
    cam.updateMatrixWorld();
    cam.getWorldDirection(_fwd);
    const dir = _fwd.clone();
    if (this.scopeT < 0.5) {
      // unscoped hip fire is loose
      dir.x += rand(-1, 1) * 0.012; dir.y += rand(-1, 1) * 0.012; dir.z += rand(-1, 1) * 0.012;
      dir.normalize();
    }
    const origin = cam.position.clone().addScaledVector(dir, 0.6);
    const bullet = { pos: origin.clone(), vel: dir.clone().multiplyScalar(this.rifle.velocity), start: origin.clone(), life: 0, pierce: this.rifle.pierce ? 1 : 0, kills: 0, deadEye: this.deadEye };
    this.bullets.push(bullet);
    g.mission.onShot();
    g.audio.play('rifle_shot', { volume: 1, ignoreSlowmo: false });
    g.audio.play('bolt', { delay: 0.28, volume: 0.65 });
    this.boltT = this.rifle.boltTime * this.reloadMult;
    this.recoil = 1;
    this.shake = Math.max(this.shake, this.settings.screenShake ? 0.5 : 0);
    // muzzle flash in the world only when not scoped (it would blind the scope)
    if (this.scopeT < 0.5) {
      g.world.fx.flashLight(cam.position.clone().addScaledVector(dir, 1.2), '#ffb060', 30, 0.06, 10);
      this.vmFlash = 0.06;
    }
    g.ui.onFire();
    // bullet cam prediction
    if (this.settings.bulletCam) this.maybeBulletCam(bullet);
  }

  // ---------------------------------------------------------------- ballistics
  updateBullets(dt) {
    const g = this.game;
    const wind = g.world.wind;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const steps = Math.max(1, Math.ceil(dt / 0.01));
      const h = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        const from = b.pos.clone();
        b.vel.y -= GRAVITY * h;
        b.vel.x += wind.x * WIND_ACCEL * h;
        b.vel.z += wind.y * WIND_ACCEL * h;
        const step = b.vel.clone().multiplyScalar(h);
        const len = step.length();
        const dir = step.clone().divideScalar(len);
        done = this.traceSegment(b, from, dir, len);
        if (!done) b.pos.add(step);
        b.life += h;
        if (b.life > 3 || b.pos.y < -50) done = true;
      }
      if (done) {
        this.bullets.splice(i, 1);
        if (this.bulletCam && this.bulletCam.bullet === b) this.bulletCam.phase = 'impact';
      }
    }
  }

  /** Test one bullet step. Returns true if the bullet stopped. */
  traceSegment(b, from, dir, len, dry = false, hitList = null) {
    const g = this.game;
    const wHit = g.world.raycast(from, dir, len);
    let best = wHit ? { t: wHit.distance, world: wHit } : null;
    for (const a of g.mission.actors) {
      if (b.ignore && b.ignore.includes(a)) continue;
      const h = a.hitTest(from, dir, best ? best.t : len);
      if (h && (!best || h.t < best.t)) best = { t: h.t, actor: a, part: h.part };
    }
    // near-miss whiz for enemies
    if (!dry && !best) {
      for (const a of g.mission.actors) {
        if (!a.enemy || !a.alive || a._whizzed === b) continue;
        const p = a.root.getWorldPosition(_tmp).add(new THREE.Vector3(0, 1.4, 0));
        const toP = p.clone().sub(from);
        const proj = toP.dot(dir);
        if (proj > 0 && proj < len && toP.clone().addScaledVector(dir, -proj).length() < 1.6) {
          a._whizzed = b;
          a.alert = 1;
          if (['aim', 'look', 'peek'].includes(a.state) && chance(0.55)) a.setState('duck');
        }
      }
    }
    if (!best) return false;
    const point = from.clone().addScaledVector(dir, best.t);
    if (dry) { hitList.push({ ...best, point }); return !best.actor || !b.pierce; }
    const dist = point.distanceTo(b.start);
    if (best.actor) {
      const a = best.actor;
      const res = a.takeHit({ part: best.part, damage: this.rifle.damage, dir, point });
      if (!res.horse) {
        g.mission.hits += b.kills === 0 && !b.counted ? 1 : 0;
        b.counted = true;
      }
      if (res.horse) {
        g.world.fx.impact(point, dir.clone().negate(), 'dirt');
        g.audio.play('impact_body', { distance: dist * 0.3, soundTravel: false });
        return true;
      }
      g.world.fx.blood(point, dir);
      g.audio.play(best.part === 'head' ? 'headshot' : 'impact_body', { volume: 1, soundTravel: false });
      g.ui.hitmarker(res.killed, best.part === 'head');
      if (res.killed) {
        b.kills++;
        this.deadEyeMeter = Math.min(1, this.deadEyeMeter + (best.part === 'head' ? 0.3 : 0.16));
        // precision pays: headshot kills on outlaws refund a round
        if (best.part === 'head' && a.enemy) { this.reserve++; g.ui.ammoRefund(); }
        g.mission.onKill(a, { part: best.part, distance: dist, collateral: b.kills >= 2, deadEye: b.deadEye || this.deadEye });
        if (this.bulletCam && this.bulletCam.bullet === b) this.bulletCam.victim = a;
      }
      if (b.pierce > 0 && a.enemy) {
        b.pierce--;
        (b.ignore ||= []).push(a);
        return false;
      }
      return true;
    }
    // world
    const obj = best.world.object;
    const normal = best.world.face ? best.world.face.normal.clone().transformDirection(obj.matrixWorld) : dir.clone().negate();
    const surface = obj.userData.surface || 'dirt';
    const exp = g.world.explosiveFor(obj);
    if (exp) { this.explode(exp, point); return true; }
    g.world.fx.impact(point, normal, surface, dir);
    const camDist = point.distanceTo(g.world.vantage);
    if (surface === 'metal') g.audio.play('impact_metal', { distance: camDist, volume: 0.7 });
    else if (surface === 'wood') g.audio.play('impact_wood', { distance: camDist, volume: 0.8 });
    else g.audio.play('impact_dirt', { distance: camDist, volume: 0.7 });
    if ((surface === 'stone' || surface === 'metal') && chance(0.35)) g.audio.play('ricochet', { distance: camDist, volume: 0.6 });
    // spook nearby enemies
    for (const a of g.mission.actors) if (a.enemy && a.alive && a.root.getWorldPosition(_tmp).distanceTo(point) < 3.5 && chance(0.6) && a.state !== 'dying') a.setState('duck');
    return true;
  }

  explode(exp, point) {
    const g = this.game;
    exp.alive = false;
    exp.obj.visible = false;
    g.world.colliders = g.world.colliders.filter((c) => c !== exp.obj);
    const center = exp.obj.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    g.world.fx.explosion(center, 1.2);
    const dist = center.distanceTo(g.world.vantage);
    g.audio.play('explosion', { distance: dist * 0.5, volume: 1 });
    this.shake = Math.max(this.shake, clamp(60 / dist, 0.3, 2.5));
    let kills = 0;
    for (const a of g.mission.actors) {
      if (!a.alive) continue;
      const d = a.root.getWorldPosition(_tmp).distanceTo(center);
      if (d < 5.5) {
        const dir = _tmp.clone().sub(center).setY(0).normalize();
        const res = a.takeHit({ part: 'body', damage: 999, dir, point: center });
        if (res.killed) {
          kills++;
          if (a.fallVel === undefined && a.deathMode !== 'fall') { a.deathMode = 'fall'; a.fallVel = dir.multiplyScalar(6).add(new THREE.Vector3(0, 6, 0)); a.groundY = g.world.heightAt(a.root.position.x, a.root.position.z); }
          g.mission.onKill(a, { part: 'body', distance: dist, explosion: true, collateral: kills >= 2 });
        }
      } else if (d < 12 && a.enemy && a.alive) a.setState('duck');
    }
    for (const e of g.world.explosives) {
      if (e.alive && e.obj.position.distanceTo(center) < 5) setTimeout(() => e.alive && this.explode(e, e.obj.position), 220);
    }
  }

  // ---------------------------------------------------------------- bullet cam
  maybeBulletCam(bullet) {
    const g = this.game;
    // simulate the trajectory against the current scene
    const sim = { pos: bullet.pos.clone(), vel: bullet.vel.clone(), pierce: bullet.pierce };
    const hits = [];
    const wind = g.world.wind;
    for (let i = 0; i < 400; i++) {
      const h = 0.01;
      sim.vel.y -= GRAVITY * h; sim.vel.x += wind.x * WIND_ACCEL * h; sim.vel.z += wind.y * WIND_ACCEL * h;
      const step = sim.vel.clone().multiplyScalar(h);
      const len = step.length();
      const stop = this.traceSegment(sim, sim.pos, step.clone().divideScalar(len), len, true, hits);
      if (stop) break;
      sim.pos.add(step);
    }
    const first = hits.find((x) => x.actor && x.actor.enemy && x.actor.alive);
    if (!first) return;
    const a = first.actor;
    const mult = first.part === 'head' ? 4 : first.part === 'body' || a.role === 'rider' ? 1 : 0.6;
    if (a.hp - this.rifle.damage * mult > 0) return;
    const dist = first.point.distanceTo(bullet.start);
    const m = g.mission;
    const lastOne = (m.objective.type === 'eliminate' || m.objective.type === 'train') && m.kills + 1 >= m.objective.count;
    const lastBoss = a.boss;
    const fancy = (first.part === 'head' && dist > 60 && chance(0.35)) || (dist > 170 && chance(0.6));
    if (!(lastOne || lastBoss || fancy) || dist < 35) return;
    this.bulletCam = { bullet, phase: 'flight', t: 0, impactT: 0, victim: null, side: chance(0.5) ? 1 : -1, target: a };
    this.bulletObj.visible = true;
    g.ui.setBulletCam(true);
    m.bulletcams++;
  }

  updateBulletCam(dt, realDt) {
    const bc = this.bulletCam;
    const cam = this.camera;
    bc.t += realDt;
    this.camera.fov = damp(this.camera.fov, 50, 4, realDt);
    this.camera.updateProjectionMatrix();
    if (bc.phase === 'flight') {
      const b = bc.bullet;
      const dir = b.vel.clone().normalize();
      this.bulletObj.position.copy(b.pos);
      this.bulletObj.lookAt(b.pos.clone().add(dir));
      this.bulletMesh.rotation.z += realDt * 20;
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const orbit = Math.sin(bc.t * 0.8) * 0.5;
      cam.position.copy(b.pos).addScaledVector(dir, -0.75).addScaledVector(side, (0.32 + orbit * 0.2) * bc.side).add(new THREE.Vector3(0, 0.12, 0));
      cam.lookAt(b.pos.clone().addScaledVector(dir, 0.6));
      if (bc.t > 6) bc.phase = 'impact';
    } else {
      bc.impactT += realDt;
      this.bulletObj.visible = false;
      const v = bc.victim || bc.target;
      if (v) {
        const c = v.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.2, 0));
        const ang = bc.side * 0.9 + bc.impactT * 0.35 * bc.side;
        const want = c.clone().add(new THREE.Vector3(Math.sin(ang) * 3.4, 0.6, Math.cos(ang) * 3.4));
        cam.position.lerp(want, clamp(realDt * 5, 0, 1));
        cam.lookAt(c);
      }
      if (bc.impactT > 1.6) this.endBulletCam();
    }
  }

  endBulletCam() {
    this.bulletCam = null;
    this.bulletObj.visible = false;
    this.game.ui.setBulletCam(false);
    this.camera.fov = this.settings.fov / (this.scoped ? this.zoom : 1);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- incoming fire
  onEnemyShot(actor, hit, from, dist) {
    const g = this.game;
    if (this.mode !== 'play') return;
    const delay = dist / 900;
    setTimeout(() => {
      if (this.mode !== 'play' || g.state !== 'playing') return;
      const toShooter = from.clone().sub(g.world.vantage);
      const ang = Math.atan2(toShooter.x, -toShooter.z) + this.yaw;
      if (hit) {
        const dmg = (actor.cfg.damage || 15) * (1 - this.armor);
        this.health -= dmg;
        this.lastHurt = 0;
        this.hurtFlash = 1;
        this.shake = Math.max(this.shake, this.settings.screenShake ? 1.2 : 0);
        this.recoil -= 0.6;
        g.audio.play('hurt', { volume: 0.9 });
        g.audio.play('impact_body', { volume: 0.7, soundTravel: false });
        g.ui.damage(ang, dmg / 30);
        g.mission.damageTaken += dmg;
        if (this.health <= 0) { this.health = 0; g.mission.onPlayerDown(); }
      } else {
        g.audio.play('whiz', { volume: 0.9, pan: clamp(Math.sin(ang), -1, 1) * 0.7 });
        const p = g.world.vantage.clone().add(new THREE.Vector3(rand(-2.2, 2.2), rand(-1.6, -0.6), rand(-2.6, -1.8)));
        g.world.fx.impact(p, new THREE.Vector3(0, 1, 0.3).normalize(), 'wood');
        if (chance(0.4)) g.audio.play('ricochet', { volume: 0.5 });
        g.ui.damage(ang, 0);
      }
    }, delay * 1000);
  }

  // ---------------------------------------------------------------- view-model
  updateViewModel(dt, t) {
    const vm = this.vmRifle;
    if (!vm) return;
    const aimK = easeOutCubic(this.scopeT);
    const bob = Math.sin(t * 1.6) * 0.004 + this.swayY * 2;
    let x = lerp(0.2, 0, aimK), y = lerp(-0.21, -0.115, aimK) + bob, z = lerp(-0.42, -0.3, aimK);
    let rx = this.recoil * 0.18, ry = lerp(0.04, 0, aimK) + this.swayX * 3, rz = 0;
    if (this.boltT > 0) {
      const k = 1 - this.boltT / (this.rifle.boltTime * this.reloadMult);
      const s = Math.sin(k * Math.PI);
      rz = s * 0.35; y -= s * 0.03;
      if (this.vmParts.bolt) this.vmParts.bolt.position.z = 0.06 + s * 0.09;
      if (this.vmParts.lever) this.vmParts.lever.rotation.x = s * 0.9;
    }
    if (this.reloading) {
      const k = 1 - this.reloadT / (this.rifle.reloadTime * this.reloadMult);
      const s = Math.sin(clamp(k, 0, 1) * Math.PI);
      y -= s * 0.12; rx -= s * 0.5; rz += s * 0.6; x -= s * 0.05;
    }
    z += this.recoil * 0.07;
    vm.position.set(x, y, z);
    vm.rotation.set(rx, ry, rz);
    this.vmRoot.visible = this.scopeT < 0.9 && !this.bulletCam;
    this.vmCamera.aspect = this.camera.aspect;
    this.vmCamera.updateProjectionMatrix();
    // match world lighting
    const W = this.game.world;
    this.vmScene.environment = W.scene.environment;
    this.vmScene.environmentIntensity = W.scene.environmentIntensity * 1.2;
    this.vmHemi.color.copy(W.hemi.color); this.vmHemi.groundColor.copy(W.hemi.groundColor); this.vmHemi.intensity = W.hemi.intensity * 1.1;
    this.vmSun.color.copy(W.sun.color); this.vmSun.intensity = W.sun.intensity * 0.8;
    this.vmFlash = Math.max(0, (this.vmFlash || 0) - dt);
  }

  // Direction the player is aiming (for the HUD)
  aimDirection(out) { return this.camera.getWorldDirection(out); }
}

