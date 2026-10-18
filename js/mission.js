// mission.js — mission director: spawns outlaws/civilians from contract data, tracks objectives,
// bounties, bonuses, stars, failure conditions, Showdown waves and tutorial prompts.
import * as THREE from 'three';
import { rand, pick, chance, shuffle } from './core.js';
import { Actor, makeHorseAt } from './actors.js';
import { BOSSES, SHOWDOWN, TERRITORIES } from './data.js';

const BOUNTY = { kill: 50, head: 40, long: 40, collateral: 100, explosion: 30, deadeye: 20, rider: 30 };

export class Mission {
  constructor(game) {
    this.game = game;
    this.actors = [];
    this.active = false;
  }

  get world() { return this.game.world; }

  /** contract: entry from CONTRACTS, or { showdown: true, territory } */
  start(contract) {
    this.clear();
    this.contract = contract;
    this.showdown = !!contract.showdown;
    this.territory = TERRITORIES[contract.territory];
    this.objective = contract.objective || { type: 'survive' };
    this.active = true;
    this.over = false;
    this.time = 0;
    this.kills = 0; this.headshots = 0; this.escapes = 0; this.civiliansDown = 0; this.rescued = 0;
    this.shots = 0; this.hits = 0; this.longest = 0; this.damageTaken = 0; this.collaterals = 0;
    this.cash = 0; this.bonusLog = []; this.combo = 0; this.comboT = 0; this.bestCombo = 0;
    this.deadeyeKills = 0; this.bulletcams = 0; this.longshots = 0; this.riderKills = 0; this.explosionKills = 0;
    this.panic = 0;
    this.spawnTimer = 1.0;
    this.bossSpawned = false;
    this.boss = null;
    this.wave = 0;
    this.waveBreak = 0;
    this.hintStep = 0;
    this.hintT = 0;
    this.enemiesCfg = contract.enemies || {};
    this.civilianLimit = contract.civilianLimit ?? 3;
    for (const s of Object.values(this.world.spawns)) if (Array.isArray(s)) s.forEach((p) => { if (p && typeof p === 'object') p.occupied = false; });
    if (this.world.train) this.world.train.cars.forEach((c) => c.slots.forEach((sl) => (sl.used = false)));

    if (this.showdown) {
      this.nextWave();
    } else {
      this.queue = [];
      for (const [role, n] of Object.entries(this.enemiesCfg.mix)) for (let i = 0; i < n; i++) this.queue.push(role);
      shuffle(this.queue);
      // keep hostage takers early so their timers matter
      this.queue.sort((a, b) => (b === 'hostage') - (a === 'hostage'));
      this.totalEnemies = this.queue.length + (contract.boss ? 1 : 0);
      this.maxActive = this.enemiesCfg.maxActive || 3;
      this.takers = this.queue.filter((r) => r === 'hostage').length;
    }
    // wind
    const w = contract.wind ? rand(...contract.wind) : 0;
    this.world.setWind(w);
    if (contract.barrels) this.world.addExplosives(contract.barrels);
    // civilians
    for (let i = 0; i < (contract.civilians || 0); i++) this.spawnCivilian();
    // hitched horses at the exits (flavour)
    for (const ex of this.world.spawns.exit) {
      for (let i = 0; i < 2; i++) {
        const h = makeHorseAt(this.game, ex.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-7, -4))), rand(-0.4, 0.4) + Math.PI / 2);
        h.update(0.016, 0);
        this.props.push(h);
      }
    }
    if (this.objective.type === 'train' && this.world.train) {
      this.world.train.start(5.2, chance(0.5) ? 1 : -1);
      this.trainStarted = true;
      this.game.audio.play('train_whistle', { distance: 140, volume: 0.9 });
      this.maxActive = 99;
      this.spawnTimer = 3.5;
    }
  }

  clear() {
    for (const a of this.actors) a.remove();
    this.actors = [];
    for (const h of this.props || []) { h.root.parent?.remove(h.root); h.dispose(); }
    this.props = [];
    this.active = false;
    this.trainStarted = false;
    if (this.world?.train) { this.world.train.active = false; this.world.train.group.visible = false; }
  }

  // ---------------------------------------------------------------- showdown
  nextWave() {
    this.wave++;
    const w = this.wave;
    const mix = SHOWDOWN.mix(w);
    const size = SHOWDOWN.waveSize(w);
    this.queue = [];
    const roles = Object.entries(mix).flatMap(([r, n]) => Array(n).fill(r));
    for (let i = 0; i < size; i++) this.queue.push(pick(roles));
    this.maxActive = SHOWDOWN.maxActive(w);
    this.enemiesCfg = { shootBack: true, aim: SHOWDOWN.aim(w), accuracy: SHOWDOWN.accuracy(w), damage: SHOWDOWN.damage(w) };
    this.waveRemaining = size;
    this.spawnTimer = 2.5;
    if (w > 1) {
      const bonus = SHOWDOWN.waveBonus(w - 1);
      this.addCash(bonus, `Wave ${w - 1} cleared`);
      this.game.combat.addAmmo(SHOWDOWN.ammoPerWave(w));
    }
    this.game.ui.banner(`WAVE ${w}`, w === 1 ? 'Survive the onslaught' : `+${SHOWDOWN.ammoPerWave(w)} rounds`);
  }

  // ---------------------------------------------------------------- spawning
  claim(list, filter) {
    const free = list.filter((s) => !s.occupied && (!filter || filter(s)));
    if (!free.length) return null;
    const s = pick(free);
    s.occupied = true;
    return s;
  }

  claimCover(actor) {
    const covers = this.world.spawns.street.filter((s) => !s.occupied);
    if (!covers.length) return null;
    const here = actor.root.position;
    covers.sort((a, b) => a.pos.distanceTo(here) - b.pos.distanceTo(here));
    const c = covers[Math.min(covers.length - 1, Math.floor(rand(0, Math.min(3, covers.length))))];
    if (actor.cover) actor.cover.occupied = false;
    c.occupied = true;
    actor.cover = c;
    return c;
  }

  activeEnemies() { return this.actors.filter((a) => a.enemy && a.alive && !a.escaped).length; }

  spawnEnemy(role) {
    const g = this.game;
    const S = this.world.spawns;
    const cfg = { ...this.enemiesCfg };
    let a;
    if (role === 'window' || role === 'roof' || role === 'balcony' || role === 'sniper') {
      let sp = this.claim(S[role]);
      if (!sp && role !== 'window') { role = 'window'; sp = this.claim(S.window); }
      if (!sp) return false;
      if (role === 'sniper') { cfg.damage = (cfg.damage || 15) * 1.6; cfg.aim = (cfg.aim || [3, 4]).map((x) => x * 1.15); }
      a = new Actor(g, role, cfg);
      a.spawn = sp;
      a.yaw = sp.yaw;
      a.root.position.copy(sp.hidden);
    } else if (role === 'street') {
      const door = pick(S.door.length ? S.door : S.window);
      if (!door) return false;
      a = new Actor(g, 'street', cfg);
      a.door = door;
      a.relocations = 0;
      if (!this.claimCover(a)) { a.remove(); return this.spawnEnemy('window'); }
      a.root.position.copy(door.hidden);
    } else if (role === 'runner') {
      const preferred = S.runnerStart.filter((d) => ['bank', 'station', 'assay', 'hotel'].includes(d.building));
      const door = pick(preferred.length ? preferred : S.runnerStart);
      if (!door) return false;
      a = new Actor(g, 'runner', { ...cfg, dynamite: this.contract.barrels > 0 && chance(0.5) });
      a.door = door;
      const streetZ = this.world.streetZ ?? door.pos.z + 6;
      a.streetPoint = new THREE.Vector3(door.pos.x + rand(-3, 3), this.world.heightAt(door.pos.x, streetZ), streetZ + rand(-2, 2));
      const exits = S.exit;
      a.exitPoint = exits.length ? exits.reduce((best, e) => (Math.abs(e.x - door.pos.x) < Math.abs(best.x - door.pos.x) === chance(0.75) ? e : best)) : new THREE.Vector3(200, 0, streetZ);
      a.runSpeed = rand(4.6, 5.8);
      a.root.position.copy(door.hidden);
    } else if (role === 'rider') {
      const lane = pick(S.rider);
      if (!lane) return this.spawnEnemy('window');
      const dir = chance(0.5) ? 1 : -1;
      a = new Actor(g, 'rider', cfg);
      const horse = makeHorseAt(g, new THREE.Vector3(dir > 0 ? lane.x0 : lane.x1, 0, lane.z), dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      horse.root.position.y = this.world.heightAt(horse.root.position.x, lane.z);
      horse.saddle.add(a.root);
      a.root.position.set(0, -0.92, 0);
      a.horse = horse;
      a.rideDir = new THREE.Vector3(dir, 0, 0);
      a.rideSpeed = rand(6.8, 9.5);
      a.speed = a.rideSpeed;
      a.exitX = dir > 0 ? lane.x1 : lane.x0;
      a.delay = rand(0, 1.5);
    } else if (role === 'train') {
      const tr = this.world.train;
      const anchor = tr?.slot();
      if (!anchor) return false;
      a = new Actor(g, 'train', cfg);
      anchor.add(a.root);
      a.anchor = anchor;
      a.delay = rand(1, 6);
    } else if (role === 'hostage') {
      const sp = this.claim(S.hostage);
      if (!sp) return this.spawnEnemy('window');
      a = new Actor(g, 'hostage', { ...cfg, shootBack: false, look: undefined });
      a.spawn = sp;
      a.root.position.copy(sp.pos);
      a.yaw = Math.atan2(this.world.vantage.x - sp.pos.x, this.world.vantage.z - sp.pos.z);
      const index = this.actors.filter((x) => x.role === 'hostage').length;
      a.timer = (this.objective.timer || 25) + index * 7;
      a.timerMax = a.timer;
      const c = new Actor(g, 'captive', { lady: chance(0.5) });
      c.rig.body.scale.multiplyScalar(0.94);
      c.root.position.copy(sp.pos);
      c.state = 'held';
      a.captive = c;
      c.holder = a;
      this.actors.push(c);
    } else if (role === 'boss') {
      const def = BOSSES[this.contract.boss];
      const spawns = [...S.window, ...S.roof, ...S.balcony].filter((s) => !s.occupied && s.pos.distanceTo(this.world.vantage) < 170);
      const sp = pick(spawns);
      if (!sp) return false;
      sp.occupied = true;
      const look = { ...randomBossLook(g, def), weapon: 'rifle' };
      a = new Actor(g, 'boss', { ...cfg, boss: true, hp: def.hp * 100, look, aim: (cfg.aim || [3, 4]).map((x) => x * 0.85), damage: (cfg.damage || 16) * 1.3 });
      a.spawn = sp;
      a.yaw = sp.yaw;
      a.root.position.copy(sp.hidden);
      a.bossName = def.name;
      a.bossDef = def;
      this.boss = a;
      g.ui.banner('WANTED', `${def.name} has appeared!`, true);
      g.audio.play('bell', { volume: 0.8 });
    } else {
      return false;
    }
    if (a.state === 'wait' && a.delay == null) a.delay = rand(0.2, 1.4);
    this.actors.push(a);
    return true;
  }

  spawnCivilian() {
    const lanes = this.world.spawns.civilianPath;
    if (!lanes.length) return;
    const lane = pick(lanes);
    const a = new Actor(this.game, 'civilian', { lady: chance(0.4) });
    a.lane = lane;
    const x = rand(lane.x0, lane.x1);
    a.root.position.set(x, this.world.heightAt(x, lane.z) + lane.y, lane.z);
    a.walkX = rand(lane.x0, lane.x1);
    a.setState('walk');
    this.actors.push(a);
  }

  bossNextSpawn(boss) {
    const S = this.world.spawns;
    const list = [...S.window, ...S.roof, ...S.balcony].filter((s) => !s.occupied && s !== boss.spawn && s.pos.distanceTo(this.world.vantage) < 170);
    return pick(list);
  }

  // ---------------------------------------------------------------- events
  addCash(amount, label) {
    this.cash += amount;
    if (label) this.bonusLog.push({ label, amount });
  }

  onShot() {
    this.shots++;
    this.panic = 1;
    // alert nearby enemies that are just looking around
    for (const a of this.actors) if (a.enemy && a.alive && a.state === 'look') a.setState('aim');
  }

  /** info: { part, distance, explosion, collateral, deadEye, bulletCam } */
  onKill(a, info) {
    const g = this.game;
    if (a.enemy) {
      this.kills++;
      if (a.cover) a.cover.occupied = false;
      if (a.spawn) a.spawn.occupied = false;
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = 4;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      let amount = a.boss ? a.bossDef.bounty : BOUNTY.kill;
      const tags = [];
      if (info.part === 'head') { this.headshots++; amount += BOUNTY.head; tags.push('HEADSHOT'); }
      if (info.distance >= 150) { this.longshots++; amount += BOUNTY.long; tags.push(`LONG SHOT ${Math.round(info.distance)}m`); }
      if (info.collateral) { this.collaterals++; amount += BOUNTY.collateral; tags.push('COLLATERAL'); }
      if (info.explosion) { this.explosionKills++; amount += BOUNTY.explosion; tags.push('KABOOM'); }
      if (info.deadEye) { this.deadeyeKills++; amount += BOUNTY.deadeye; tags.push('DEAD-EYE'); }
      if (a.role === 'rider') { this.riderKills++; amount += BOUNTY.rider; tags.push('UNHORSED'); }
      if (this.combo >= 2) { amount = Math.round(amount * (1 + Math.min(this.combo - 1, 4) * 0.25)); tags.push(`x${this.combo} STREAK`); }
      this.longest = Math.max(this.longest, info.distance);
      this.addCash(amount);
      g.ui.killPopup(a.boss ? `${a.bossName} DOWN` : tags[0] || 'OUTLAW DOWN', tags.slice(a.boss ? 0 : 1), amount, info.part === 'head');
      if (a.role === 'hostage' && a.captive) {
        const c = a.captive;
        a.captive = null;
        c.role = 'captive';
        c.setState('freed');
        c.basePose = c.basePose;
        this.rescued++;
        g.ui.toast('Hostage rescued!', 'good');
        this.addCash(75, 'Hostage rescued');
      }
      if (a.boss) {
        // remaining gang flees
        for (const o of this.actors) if (o.enemy && o.alive && o !== a && ['window', 'roof', 'balcony', 'sniper'].includes(o.role)) o.setState('duck');
      }
      if (this.showdown) this.waveRemaining--;
      // nearby outlaws get spooked
      for (const o of this.actors) {
        if (o !== a && o.enemy && o.alive && o.root.position.distanceTo(a.root.position) < 12 && o.state === 'aim' && chance(0.5)) o.setState('duck');
      }
    } else {
      this.onCivilianDown(a);
    }
  }

  onCivilianDown(a) {
    if (a._counted) return;
    a._counted = true;
    this.civiliansDown++;
    const penalty = 150;
    this.addCash(-penalty, 'Civilian casualty');
    this.game.ui.killPopup('CIVILIAN HIT', ['Bounty docked'], -penalty, false, true);
    if (this.civiliansDown >= this.civilianLimit) this.fail(a.role === 'captive' ? 'A hostage was killed.' : 'Too many civilians were hurt.');
  }

  onHostageExecuted() {
    this.game.ui.toast('A hostage was executed!', 'bad');
  }

  onEscape(a) {
    if (a.cover) a.cover.occupied = false;
    this.escapes++;
    if (this.showdown) this.waveRemaining--;
    this.game.ui.toast(a.role === 'train' ? 'An outlaw rode out on the train!' : 'An outlaw escaped!', 'bad');
    const max = this.objective.maxEscape ?? 99;
    if (this.objective.type === 'escape' && this.escapes > max) this.fail(`${this.escapes} outlaws got away.`);
  }

  onBossWounded(boss) {
    this.game.ui.toast(`${boss.bossName} is wounded — he's moving!`, 'good');
  }

  onPlayerDown() { this.fail('You were gunned down.'); }
  onOutOfAmmo() { this.fail('You ran out of ammunition.'); }

  // ---------------------------------------------------------------- objectives
  objectiveInfo() {
    const o = this.objective;
    if (this.showdown) return { text: `Showdown — Wave ${this.wave}`, progress: `${this.kills} kills`, sub: `${this.waveRemaining} left this wave` };
    switch (o.type) {
      case 'eliminate': return { text: 'Eliminate the outlaws', progress: `${Math.min(this.kills, o.count)}/${o.count}` };
      case 'escape': return { text: 'Stop the outlaws escaping', progress: `${this.kills} down`, sub: `Escaped ${this.escapes}/${o.maxEscape + 1}` };
      case 'hostage': return { text: 'Rescue the hostages', progress: `${this.rescued}/${this.takers}`, sub: this.civiliansDown ? `${this.civiliansDown} lost` : 'Don\'t hit the hostages' };
      case 'boss': return { text: this.boss && this.boss.alive ? `Kill ${this.boss.bossName}` : 'Thin out the gang', progress: this.boss ? '' : `${this.kills} down`, sub: this.bossSpawned ? '' : 'The boss will show himself soon' };
      case 'train': return { text: 'Clear the train', progress: `${Math.min(this.kills, o.count)}/${o.count}` };
      default: return { text: 'Survive', progress: '' };
    }
  }

  checkWin() {
    const o = this.objective;
    if (this.showdown) return false;
    switch (o.type) {
      case 'eliminate': return this.kills >= o.count;
      case 'train': return this.kills >= o.count;
      case 'escape': return this.queue.length === 0 && this.activeEnemies() === 0 && this.escapes <= o.maxEscape;
      case 'hostage': return this.rescued >= this.takers && this.actors.filter((a) => a.role === 'hostage' && a.alive).length === 0;
      case 'boss': return this.boss && !this.boss.alive;
      default: return false;
    }
  }

  fail(reason) {
    if (this.over) return;
    this.over = true;
    this.game.endMission(false, reason);
  }

  win() {
    if (this.over) return;
    this.over = true;
    this.game.endMission(true);
  }

  stars() {
    if (this.showdown) return 0;
    const st = this.contract.stars || { accuracy: 0.6, headshots: 3 };
    const acc = this.shots ? this.hits / this.shots : 0;
    return 1 + (acc >= st.accuracy ? 1 : 0) + (this.headshots >= st.headshots ? 1 : 0);
  }

  // ---------------------------------------------------------------- tutorial
  updateHints(dt) {
    if (!this.contract.tutorial || !this.game.profile.settings.hints) return;
    const c = this.game.combat;
    this.hintT += dt;
    const steps = [
      { text: 'Move the <b>MOUSE</b> (or <b>WASD</b>) to look over Dustwater Gulch', done: () => this.hintT > 4 },
      { text: 'Hold <b>RIGHT MOUSE</b> or <b>SHIFT</b> to look down your scope', done: () => c.scoped },
      { text: 'Scroll the <b>MOUSE WHEEL</b> or press <b>Q / E</b> to change zoom', done: () => c.zoomChanged || this.hintT > 7 },
      { text: 'Hold <b>SPACE</b> to steady your breath', done: () => c.holdingBreath },
      { text: '<b>LEFT CLICK</b> to fire. Aim for the head!', done: () => this.shots > 0 },
      { text: 'Press <b>R</b> to reload any time. Press <b>F</b> for Dead-Eye once the meter fills', done: () => this.hintT > 6 },
    ];
    const s = steps[this.hintStep];
    if (!s) { this.game.ui.hint(null); return; }
    this.game.ui.hint(s.text);
    if (s.done()) { this.hintStep++; this.hintT = 0; }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    this.updateHints(dt);
    // spawning
    this.spawnTimer -= dt;
    if (!this.over && this.spawnTimer <= 0 && this.queue.length && this.activeEnemies() < this.maxActive) {
      const role = this.queue.shift();
      if (!this.spawnEnemy(role)) this.queue.push(role);
      this.spawnTimer = this.objective.type === 'train' ? 0.1 : rand(1.2, 2.6);
    }
    // boss entrance
    if (!this.showdown && this.contract.boss && !this.bossSpawned) {
      const henchmen = this.totalEnemies - 1;
      if (this.kills >= Math.ceil(henchmen * 0.5) || this.time > 55) {
        if (this.spawnEnemy('boss')) this.bossSpawned = true;
      }
    }
    // keep boss contracts populated
    if (!this.showdown && this.objective.type === 'boss' && this.boss?.alive && !this.queue.length && this.activeEnemies() < 2 && chance(dt * 0.2)) {
      this.queue.push(pick(['window', 'roof', 'street']));
    }
    for (const a of this.actors) a.update(dt);
    // prune removed actors
    if (this.actors.some((a) => a.removed)) this.actors = this.actors.filter((a) => !a.removed);
    this.panic = Math.max(0, this.panic - dt * 0.02);

    if (this.over) return;
    if (this.showdown) {
      if (this.waveRemaining <= 0 && this.activeEnemies() === 0) {
        this.waveBreak += dt;
        if (this.waveBreak > 2.5) { this.waveBreak = 0; this.nextWave(); }
      }
      return;
    }
    if (this.objective.type === 'train' && this.trainStarted && !this.world.train.active) {
      if (this.kills < this.objective.count) this.fail('The train got away with the outlaws.');
    }
    if (this.checkWin()) this.win();
    // safety: nothing left to fight but objective incomplete
    if (!this.queue.length && this.activeEnemies() === 0 && this.objective.type === 'eliminate' && this.kills < this.objective.count) {
      this.queue.push(pick(['window', 'roof', 'street']));
    }
  }
}

function randomBossLook(game, def) {
  return {
    kind: 'outlaw', skin: pick(['#c58c64', '#a8704e', '#d9a07a']), shirt: '#' + def.shirt.toString(16).padStart(6, '0'),
    coat: '#' + def.coat.toString(16).padStart(6, '0'), vest: null, pants: '#1e1a18', hat: '#' + def.hat.toString(16).padStart(6, '0'),
    hatType: 'cowboy', bandana: '#' + def.bandana.toString(16).padStart(6, '0'), mask: false, boots: '#140e0a', belt: '#1a1008',
    mustache: true, beard: chance(0.5), hair: '#1a120c', gloves: '#1a1410', scale: 1.06,
  };
}

