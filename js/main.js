// main.js — bootstrap, renderer, game state machine, main loop, menu camera, portraits,
// settings application and end-of-contract reward settlement.
import * as THREE from 'three';
import { EventBus, Input, rand } from './core.js';
import { Profile, CONTRACTS, TERRITORIES, BOSSES } from './data.js';
import { AudioEngine } from './audio.js';
import { Assets } from './assets.js';
import { World } from './world.js';
import { Rig, randomLook } from './actors.js';
import { Mission } from './mission.js';
import { Combat } from './combat.js';
import { UI } from './ui.js';

const PIXEL_RATIO = { low: 0.75, medium: 1, high: 1.5, ultra: 2 };

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.events = new EventBus();
    this.profile = new Profile(this.events);
    this.state = 'loading';
    this.muted = false;
    this.clock = new THREE.Clock();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine(this.profile.settings);
    this.assets = new Assets(this.renderer);
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async init() {
    let pa = 0, pb = 0;
    const progress = () => this.ui.setLoading(pa * 0.65 + pb * 0.35);
    this.ui.setLoading(0.02, 'Loading textures & models…');
    await Promise.all([
      this.assets.load((p) => { pa = p; progress(); }),
      this.audio.load((p) => { pb = p; progress(); }),
    ]);
    this.ui.setLoading(0.98, 'Building the frontier…');
    await new Promise((r) => setTimeout(r, 30));
    this.world = new World(this);
    this.mission = new Mission(this);
    this.combat = new Combat(this);
    this.applySettings();
    this.buildMenuWorld();
    this.bindKeys();
    this.input.events.on('lockchange', (locked) => {
      if (locked) this.hadLock = true;
      else if (this.state === 'playing' && this.hadLock) this.pause();
    });
    this.input.events.on('mousedown', () => {
      if (this.state === 'intro') { this.combat.introT = 99; return; }
      if (this.state === 'playing' && !this.input.locked && this.wantsLock && !this.lockUnavailable) {
        // this click only captures the mouse — it must not also fire
        this.lockFromClick = true;
        this.input.requestLock();
        this.input.mouse.leftPressed = false;
      }
    });
    document.addEventListener('pointerlockerror', () => {
      // sandboxed frames etc.: fall back to free-mouse aiming
      if (this.lockFromClick) { this.lockUnavailable = true; this.wantsLock = false; }
    });
    this.input.events.on('blur', () => { if (this.state === 'playing') this.pause(); });
    this.ui.loadingDone();
    this.state = 'title';
    this.loop();
    window.__game = this;
  }

  // ---------------------------------------------------------------- settings
  applySettings() {
    const s = this.profile.settings;
    this.audio.applyVolumes();
    if (this.muted) this.audio.master.gain.value = 0;
    this.world?.setShadowQuality(s.quality);
    this.resize();
    if (this.combat && this.state !== 'playing') this.camera.fov = s.fov;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.profile.settings.quality] ?? 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.ui.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.audio.master) this.audio.master.gain.value = this.muted ? 0 : this.profile.settings.master;
    this.ui.setMuteIcon(this.muted);
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } catch (e) { /* fullscreen unsupported */ }
  }

  // ---------------------------------------------------------------- keys
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      if (code === 'KeyM') { this.toggleMute(); return; }
      if (this.state === 'title' && (code === 'Enter' || code === 'Space')) { e.preventDefault(); this.enterMenu(); return; }
      if (this.state === 'intro' && (code === 'Enter' || code === 'Space' || code === 'Escape')) { e.preventDefault(); this.combat.introT = 99; return; }
      if (this.state === 'playing') {
        if (code === 'Escape' || code === 'KeyP') { e.preventDefault(); this.pause(); }
        if (code === 'Tab') { e.preventDefault(); const o = this.mission.objectiveInfo(); this.ui.banner(o.text, [o.progress, o.sub].filter(Boolean).join(' · '), true); }
        return;
      }
      if (this.state === 'paused') {
        if (code === 'Escape' || code === 'KeyP') {
          e.preventDefault();
          if (this.ui.current === 'pause') this.resume(); else this.ui.back();
        }
        return;
      }
      if (code === 'Escape') {
        if (this.state === 'results') { this.quitToMenu(); return; }
        if (this.ui.current && this.ui.current !== 'menu' && this.ui.current !== 'loading') this.ui.back();
        return;
      }
      if (code === 'Enter') {
        const active = document.activeElement;
        if (active && (active.tagName === 'BUTTON' || active.classList.contains('contract-card'))) return; // native click
        const scr = document.getElementById(this.ui.current);
        const primary = scr?.querySelector('.btn-gold:not([disabled])');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    });
  }

  // ---------------------------------------------------------------- flow
  enterMenu() {
    if (this.state !== 'title') return;
    this.audio.unlock();
    this.toggleFullscreen();
    this.audio.playMusic('theme_menu');
    this.audio.loop('wind_loop', 0.25);
    this.state = 'menu';
    this.ui.show('menu', { push: false });
    setTimeout(() => this.ui.showDaily(), 600);
  }

  buildMenuWorld() {
    let t = 0;
    TERRITORIES.forEach((_, i) => { if (this.profile.territoryUnlocked(i)) t = i; });
    const terr = TERRITORIES[t];
    this.world.build(terr.layout, terr.time, 3);
    this.currentWorldKey = null;
    this.mission.start({ ambient: true, territory: t, civilians: 7, objective: { type: 'ambient' }, enemies: { mix: {} } });
    this.menuT = rand(0, 100);
  }

  bossDef(key) { return BOSSES[key]; }

  startContract(c) {
    this.lastContract = c;
    this.lastShowdown = false;
    this.launch(c);
  }

  startShowdown() {
    let t = 0;
    TERRITORIES.forEach((_, i) => { if (this.profile.territoryUnlocked(i)) t = i; });
    const c = { showdown: true, territory: t, name: 'Showdown', ammo: 10, civilians: 0, wind: t > 0 ? [1, 3] : null, enemies: { mix: {} }, objective: { type: 'survive' } };
    this.lastShowdown = true;
    this.lastContract = c;
    this.launch(c);
  }

  launch(c) {
    const terr = TERRITORIES[c.territory];
    this.mission.clear();
    this.world.build(terr.layout, terr.time, CONTRACTS.indexOf(c) + 7);
    this.combat.reset(c);
    this.mission.start(c);
    this.combat.startIntro();
    this.ui.hideAll();
    this.ui.setHUD(true);
    this.ui.setBulletCam(true);
    this.state = 'intro';
    this.wantsLock = false;
    this.hadLock = false;
    this.audio.playMusic('theme_battle', 2);
    this.audio.stopLoop('wind_loop');
    this.audio.loop('wind_loop', 0.35);
    this.endingT = null;
  }

  onIntroDone() {
    this.ui.setBulletCam(false);
    this.state = 'playing';
    this.wantsLock = !this.lockUnavailable;
    this.input.resetMouse();
    const c = this.mission.contract;
    if (c.showdown) this.ui.banner('SHOWDOWN', 'Survive as long as you can', true);
    else this.ui.banner(c.name, this.mission.objectiveInfo().text, true);
    this.input.requestLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.input.down.clear();
    this.ui.show('pause', { push: false });
    this.audio.setTimeScale(1);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideAll();
    this.ui.stack = [];
    this.state = 'playing';
    this.clock.getDelta();
    this.input.resetMouse();
    this.input.requestLock();
  }

  restart() {
    if (this.lastShowdown) this.startShowdown();
    else this.startContract(this.lastContract || CONTRACTS[0]);
  }

  quitToMenu() {
    this.input.exitLock();
    this.mission.clear();
    this.combat.mode = 'idle';
    this.combat.bulletCam = null;
    this.combat.bulletObj.visible = false;
    this.ui.setHUD(false);
    this.ui.setBulletCam(false);
    document.body.classList.remove('deadeye');
    this.audio.setMuffle(0);
    this.audio.setTimeScale(1);
    this.buildMenuWorld();
    this.state = 'menu';
    this.camera.fov = this.profile.settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.playMusic('theme_menu');
    this.ui.show('menu', { push: false });
  }

  /** Called by the mission when it is won or lost. Settles cash, stars, stats and achievements. */
  endMission(success, reason) {
    if (this.endingT != null) return;
    this.endingT = success ? 1.6 : 1.0;
    this.pendingResult = { success, reason };
  }

  settle() {
    const { success, reason } = this.pendingResult;
    const m = this.mission, p = this.profile, c = m.contract;
    this.input.exitLock();
    this.state = 'results';
    if (this.combat.bulletCam) this.combat.endBulletCam();
    this.ui.setHUD(false);
    document.body.classList.remove('deadeye');
    this.audio.setMuffle(0);
    this.audio.setTimeScale(1);
    const terrBefore = TERRITORIES.map((_, i) => p.territoryUnlocked(i));
    const breakdown = [];
    const killCash = m.bonusLog.filter((b) => b.amount < 0 || b.label.startsWith('Wave') || b.label.startsWith('Hostage'));
    const bounties = m.cash - killCash.reduce((a, b) => a + b.amount, 0);
    let stars = 0;
    if (m.showdown) {
      breakdown.push({ label: 'Outlaw bounties', amount: bounties });
      for (const b of killCash) breakdown.push(b);
    } else if (success) {
      stars = m.stars();
      breakdown.push({ label: 'Contract reward', amount: c.reward });
      breakdown.push({ label: 'Outlaw bounties', amount: bounties });
      for (const b of killCash) breakdown.push(b);
      if (m.damageTaken === 0) breakdown.push({ label: 'Untouchable bonus', amount: 100 });
      const acc = m.shots ? m.hits / m.shots : 0;
      if (acc >= 0.8) breakdown.push({ label: 'Marksman accuracy', amount: 120 });
      if (stars === 3) breakdown.push({ label: 'Three-star bonus', amount: 150 });
    } else {
      breakdown.push({ label: 'Partial bounties (50%)', amount: Math.round(bounties * 0.5) });
      for (const b of killCash.filter((x) => x.amount < 0)) breakdown.push(b);
    }
    const total = Math.max(0, breakdown.reduce((a, b) => a + b.amount, 0));
    p.addCash(total);
    const rankUp = p.addXp(total * 0.5 + m.kills * 12 + (success ? 120 : 0));
    // stats
    p.stat('kills', m.kills); p.stat('headshots', m.headshots); p.stat('shots', m.shots); p.stat('hits', m.hits);
    p.stat('collaterals', m.collaterals); p.stat('explosionKills', m.explosionKills); p.stat('riderKills', m.riderKills);
    p.stat('deadeyeKills', m.deadeyeKills); p.stat('bulletcams', m.bulletcams); p.stat('longshots', m.longshots);
    p.statMax('longest', m.longest);
    if (m.boss && !m.boss.alive) p.stat('bossesKilled');
    let newBest = false;
    if (m.showdown) {
      newBest = m.wave > (p.data.stats.bestWave || 0);
      p.statMax('bestWave', m.wave);
      p.statMax('bestShowdown', m.cash);
    } else if (success) {
      p.recordContract(c.id, stars);
      if (m.damageTaken === 0) p.stat('flawless');
    }
    const achievements = p.checkAchievements();
    p.save();
    const unlockedIdx = TERRITORIES.findIndex((_, i) => !terrBefore[i] && p.territoryUnlocked(i));
    this.ui.showResults({
      success: m.showdown ? true : success, reason, contract: c, showdown: m.showdown, wave: m.wave, newBest, stars,
      kills: m.kills, headshots: m.headshots, shots: m.shots, hits: m.hits, longest: m.longest, bestCombo: m.bestCombo,
      time: m.time, escapes: m.escapes, civiliansDown: m.civiliansDown, breakdown, total, rankUp, achievements,
      unlocked: unlockedIdx >= 0 ? TERRITORIES[unlockedIdx].name : null,
    });
    this.audio.play(success || m.showdown ? 'victory' : 'defeat', { volume: 0.9 });
    this.audio.playMusic('theme_menu', 3);
    this.combat.mode = 'idle';
  }

  // ---------------------------------------------------------------- portraits & thumbnails
  // Renders a small scene into the corner of the WebGL canvas and copies it to a 2D canvas.
  snapshot(scene, cam, target) {
    const r = this.renderer;
    const pr = r.getPixelRatio();
    const w = target.width / pr, h = target.height / pr;
    const fullH = this.canvas.height;
    r.setScissorTest(true);
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    r.render(scene, cam);
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(this.canvas, 0, fullH - h * pr, w * pr, h * pr, 0, 0, target.width, target.height);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.canvas.width / pr, this.canvas.height / pr);
  }

  portraitScene() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#fff4e0', '#5a3a20', 1.6));
    const key = new THREE.DirectionalLight('#ffe8c8', 3);
    key.position.set(1.5, 2.5, 2.5);
    scene.add(key);
    return scene;
  }

  drawPortrait(canvas, bossKey) {
    const scene = this.portraitScene();
    scene.background = new THREE.Color('#d9c29a');
    const def = bossKey ? BOSSES[bossKey] : null;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const look = def ? { kind: 'outlaw', skin: '#b07a54', shirt: hex(def.shirt), coat: hex(def.coat), pants: '#1e1a18', hat: hex(def.hat), hatType: 'cowboy', bandana: hex(def.bandana), mask: false, boots: '#140e0a', belt: '#1a1008', mustache: true, beard: bossKey !== 'delgado', hair: '#1a120c', weapon: 'rifle', scale: 1 }
      : randomLook(this.assets, 'outlaw', { mask: true, bandana: '#8a1e1e', weapon: 'rifle' });
    const rig = new Rig(this.assets, look);
    rig.j.shR.rotation.set(-0.95, 0.2, -0.35); rig.j.elR.rotation.set(-1.35, 0, 0);
    rig.j.shL.rotation.set(-1.45, 0, -0.32); rig.j.elL.rotation.set(-0.35, 0, 0);
    rig.root.rotation.y = -0.35;
    scene.add(rig.root);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    cam.position.set(0.15, 1.6, 1.55);
    cam.lookAt(0, 1.5, 0);
    this.snapshot(scene, cam, canvas);
    rig.dispose();
  }

  drawRifleThumb(canvas, model) {
    const scene = this.portraitScene();
    const rifle = this.assets.build(model, 'rifles', { castShadow: false });
    rifle.rotation.set(0, Math.PI / 2, 0.08);
    const box = new THREE.Box3().setFromObject(rifle);
    const center = box.getCenter(new THREE.Vector3());
    rifle.position.sub(center);
    scene.add(rifle);
    const size = box.getSize(new THREE.Vector3()).length();
    const cam = new THREE.PerspectiveCamera(22, 1, 0.01, 20);
    cam.position.set(0, 0.08, size * 1.2);
    cam.lookAt(0, 0, 0);
    this.snapshot(scene, cam, canvas);
  }

  // ---------------------------------------------------------------- loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const realDt = Math.min(this.clock.getDelta(), 0.05);
    const st = this.state;
    if (st === 'intro' || st === 'playing') {
      let ts = this.combat.timeScale;
      if (this.endingT != null) {
        ts = Math.min(ts, 0.35);
        this.endingT -= realDt;
        if (this.endingT <= 0 && !this.combat.bulletCam) { this.settle(); }
      }
      this.audio.setTimeScale(ts);
      const dt = realDt * ts;
      this.combat.update(dt, realDt);
      if (this.state === 'intro' || this.state === 'playing') {
        this.mission.update(dt);
        this.world.update(dt);
        this.ui.updateHUD(realDt);
      }
    } else if (st === 'menu' || st === 'title' || st === 'results' || st === 'loading') {
      if (this.world) {
        this.mission.update(realDt);
        this.world.update(realDt);
        if (st !== 'results') this.menuCamera(realDt);
      }
    }
    this.render();
    this.input.endFrame();
  }

  menuCamera(dt) {
    this.menuT += dt;
    const t = this.menuT;
    const cam = this.camera;
    const a = t * 0.035;
    cam.position.set(Math.sin(a) * 75 + 10, 24 + Math.sin(t * 0.07) * 5, -28 + Math.cos(a) * 26);
    cam.lookAt(Math.sin(t * 0.025) * 30, 5, -92);
    cam.fov = 55;
    cam.updateProjectionMatrix();
  }

  render() {
    if (!this.world) return;
    const r = this.renderer;
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.world.scene, this.camera);
    const c = this.combat;
    if ((this.state === 'playing' || this.state === 'paused') && c.mode === 'play' && c.vmRoot.visible && !c.bulletCam) {
      r.clearDepth();
      r.render(c.vmScene, c.vmCamera);
    }
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const t = document.getElementById('loadText');
  if (t) t.textContent = 'Something went wrong loading the game. Please make sure WebGL is enabled and serve the folder over http.';
});

