// ui.js — menus (main, contracts, briefing, gunsmith, bounty board, settings, how-to, pause, results),
// keyboard/mouse menu navigation, HUD, kill feed, banners and the canvas scope/marker overlay.
import * as THREE from 'three';
import { clamp, fmtMoney, fmtTime, toScreen, easeOutCubic } from './core.js';
import { TITLE, RIFLES, UPGRADES, TERRITORIES, CONTRACTS, ACHIEVEMENTS, DAILY_REWARDS, TIPS } from './data.js';
import { GRAVITY, WIND_ACCEL } from './combat.js';

const $ = (id) => document.getElementById(id);
const OBJECTIVE_LABEL = { eliminate: 'Elimination', escape: 'Stop the Getaway', hostage: 'Hostage Rescue', boss: 'Wanted Boss', train: 'Train Ambush' };
const TIME_LABEL = { noon: 'High Noon', sunset: 'Sundown', night: 'Midnight' };
const _p = new THREE.Vector3(), _s = {};

export class UI {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.current = 'loading';
    this.canvas = $('overlay');
    this.ctx = this.canvas.getContext('2d');
    this.hits = [];
    this.damageArcs = [];
    this.lastCash = 0;
    this.territoryTab = 0;
    this.bindButtons();
    this.bindNavigation();
    this.buildSettings();
    $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    if (Math.random() < 0.5) document.querySelector('.load-bg').style.backgroundImage = "url('assets/images/backgrounds/junction_bg.jpg')";
    document.title = TITLE;
  }

  // ---------------------------------------------------------------- screens
  show(id, { push = true, keepStack = false } = {}) {
    const prev = this.current;
    if (push && prev && prev !== id && !keepStack) this.stack.push(prev);
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    this.current = id;
    if (id === 'menu') { this.stack = []; this.refreshMenu(); }
    if (id === 'contracts') this.renderContracts();
    if (id === 'gunsmith') this.renderGunsmith();
    if (id === 'bounty') this.renderBounty();
    if (id === 'settings') this.syncSettings();
    if (id === 'pause') $('pauseObjective').textContent = this.game.mission.objectiveInfo().text;
    if (id === 'briefing') $('briefRifle').textContent = this.game.profile.rifle().name.split(' ')[0];
    // overlays (pause/results) keep the world behind them
    requestAnimationFrame(() => this.focusFirst());
  }
  hideAll() { document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active')); this.current = null; }
  back() {
    const prev = this.stack.pop();
    if (prev) this.show(prev, { push: false });
    else if (this.current !== 'menu') this.show('menu', { push: false });
  }

  bindButtons() {
    const g = this.game;
    const on = (id, fn) => $(id)?.addEventListener('click', fn);
    on('btnEnter', () => g.enterMenu());
    on('btnPlay', () => this.openBriefing(g.profile.nextContract()));
    on('btnContracts', () => this.show('contracts'));
    on('btnShowdown', () => {
      if (!g.profile.showdownUnlocked()) { this.toastMenu('Complete "Bank Run" to unlock Showdown'); return; }
      g.startShowdown();
    });
    on('btnGunsmith', () => this.show('gunsmith'));
    on('btnBounty', () => this.show('bounty'));
    on('btnSettings', () => this.show('settings'));
    on('btnHowTo', () => this.show('howto'));
    on('btnMute', () => g.toggleMute());
    on('btnFullscreen', () => g.toggleFullscreen());
    on('btnStart', () => g.startContract(this.briefContract));
    on('btnBriefGunsmith', () => this.show('gunsmith'));
    on('btnResume', () => g.resume());
    on('btnRestart', () => g.restart());
    on('btnPauseSettings', () => this.show('settings'));
    on('btnPauseHowTo', () => this.show('howto'));
    on('btnQuit', () => g.quitToMenu());
    on('btnHudPause', () => g.pause());
    on('btnResMenu', () => g.quitToMenu());
    on('btnResRetry', () => g.restart());
    on('btnResNext', () => {
      if (this.lastResult?.showdown) { g.startShowdown(); return; }
      const next = this.lastResult?.success ? g.profile.nextContract() : this.lastResult?.contract;
      g.quitToMenu();
      this.openBriefing(next || CONTRACTS[0]);
    });
    on('btnClaimDaily', () => {
      const amt = g.profile.claimDaily();
      g.audio.play('cash');
      this.toastMenu(`+${fmtMoney(amt)} daily reward!`);
      this.show('menu', { push: false });
    });
    on('btnReset', () => this.confirm('Reset all progress?', 'Your cash, rifles, upgrades and stars will be wiped.', () => { g.profile.reset(); this.show('menu', { push: false }); }));
    on('btnConfirmNo', () => this.back());
    on('btnConfirmYes', () => { const fn = this.confirmFn; this.back(); fn && fn(); });
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => this.back()));
    document.querySelectorAll('#gunsmith .tab').forEach((t) => t.addEventListener('click', () => this.renderGunsmith(t.dataset.tab)));
    // UI sounds
    document.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.btn, .tab, .contract-card, .territory-tab, .icon-btn');
      if (b && b !== this.hovered) { this.hovered = b; g.audio.play('ui_hover', { volume: 0.35 }); }
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('.btn, .tab, .contract-card, .territory-tab, .icon-btn, .toggle, .seg button')) g.audio.play('ui_click', { volume: 0.6 });
    }, true);
  }

  // Arrow keys move focus between controls on the active screen; Enter activates.
  bindNavigation() {
    window.addEventListener('keydown', (e) => {
      if (!this.current || this.current === 'loading' && $('btnEnter').classList.contains('hidden')) return;
      if (this.game.state === 'playing' || this.game.state === 'intro') return;
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS'];
      if (!keys.includes(e.code)) return;
      const active = document.activeElement;
      if (active && active.type === 'range' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
      const list = this.focusables();
      if (!list.length) return;
      e.preventDefault();
      let i = list.indexOf(active);
      const fwd = e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS';
      i = i < 0 ? 0 : (i + (fwd ? 1 : -1) + list.length) % list.length;
      list[i].focus();
      this.game.audio.play('ui_hover', { volume: 0.35 });
    });
  }
  focusables() {
    const scr = document.querySelector('.screen.active:last-of-type') || document.querySelector('.screen.active');
    const root = document.getElementById(this.current) || scr;
    if (!root) return [];
    return [...root.querySelectorAll('button, .contract-card, input[type=range]')].filter((el) => el.offsetParent !== null && !el.disabled);
  }
  focusFirst() {
    const list = this.focusables();
    const primary = list.find((b) => b.classList.contains('btn-gold')) || list[0];
    if (primary && this.game.input && !this.game.input.locked) primary.focus({ preventScroll: true });
  }

  confirm(title, text, fn) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    this.confirmFn = fn;
    this.show('confirm');
  }

  toastMenu(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    t.style.cssText = 'position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:50;font-size:1.3rem';
    document.getElementById('app').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------------------------------------------------------------- loading
  setLoading(p, text) {
    $('loadFill').style.width = `${Math.round(p * 100)}%`;
    document.querySelector('.load-bullet').style.left = `${Math.round(p * 100)}%`;
    if (text) $('loadText').textContent = text;
  }
  loadingDone() {
    $('loadText').textContent = 'Ready when you are, partner.';
    $('btnEnter').classList.remove('hidden');
    $('btnEnter').focus();
  }

  // ---------------------------------------------------------------- main menu
  refreshMenu() {
    const p = this.game.profile;
    const r = p.rank();
    $('rankLevel').textContent = r.index + 1;
    $('rankName').textContent = r.name;
    $('xpFill').style.width = `${Math.round(r.progress * 100)}%`;
    document.querySelectorAll('.cash-val').forEach((el) => (el.textContent = fmtMoney(p.cash)));
    $('menuStars').textContent = `${p.totalStars()}/45`;
    const next = p.nextContract();
    $('nextContractName').textContent = next ? next.name : '';
    $('showdownLock').textContent = p.showdownUnlocked() ? `Best: wave ${p.data.stats.bestWave || 0}` : 'Locked';
    $('btnShowdown').classList.toggle('locked', !p.showdownUnlocked());
    const list = $('menuChallenges');
    list.innerHTML = '';
    let claimable = false;
    for (const c of p.data.challenges.list) {
      const li = document.createElement('li');
      const done = c.progress >= c.target;
      if (done && !c.claimed) claimable = true;
      li.className = done ? 'done' : '';
      li.innerHTML = `${c.claimed ? '✔ ' : ''}${c.text} <span style="float:right;opacity:.8">${fmtMoney(c.reward)}</span><div class="p"><i style="width:${(c.progress / c.target) * 100}%"></i></div>`;
      list.appendChild(li);
    }
    $('bountyDot').classList.toggle('hidden', !claimable && !p.dailyStatus().available);
    this.setMuteIcon(this.game.muted);
  }

  setMuteIcon(muted) {
    const i = $('btnMute').querySelector('.ico');
    i.className = `ico ${muted ? 'ico-mute' : 'ico-sound'}`;
  }

  showDaily() {
    const st = this.game.profile.dailyStatus();
    if (!st.available) return false;
    const row = $('dailyStreak');
    row.innerHTML = '';
    DAILY_REWARDS.forEach((amt, i) => {
      const d = document.createElement('div');
      d.className = 'day' + (i + 1 < st.day ? ' got' : '') + (i + 1 === st.day ? ' today' : '');
      d.innerHTML = `Day ${i + 1}<b>${fmtMoney(amt)}</b>`;
      row.appendChild(d);
    });
    $('dailyAmount').textContent = fmtMoney(st.amount);
    this.show('daily');
    return true;
  }

  // ---------------------------------------------------------------- contracts
  renderContracts() {
    const p = this.game.profile;
    $('contractStars').textContent = `${p.totalStars()}/45`;
    const tabs = $('territoryTabs');
    tabs.innerHTML = '';
    TERRITORIES.forEach((t, i) => {
      const b = document.createElement('button');
      const locked = !p.territoryUnlocked(i);
      b.className = 'territory-tab' + (i === this.territoryTab ? ' active' : '') + (locked ? ' locked' : '');
      b.style.setProperty('--tc', t.color);
      const stars = CONTRACTS.filter((c) => c.territory === i).reduce((a, c) => a + p.contractStars(c.id), 0);
      b.innerHTML = `<div class="tt-name">${t.name}</div><div class="tt-sub">${t.subtitle} · ${TIME_LABEL[t.time]}</div>` +
        `<div class="tt-lock">${locked ? `<i class="ico ico-lock"></i>${t.starsRequired} <i class="ico ico-star"></i>` : `${stars}/15 <i class="ico ico-star"></i>`}</div>`;
      b.addEventListener('click', () => { this.territoryTab = i; this.renderContracts(); });
      tabs.appendChild(b);
    });
    const grid = $('contractGrid');
    grid.innerHTML = '';
    const next = p.nextContract();
    CONTRACTS.filter((c) => c.territory === this.territoryTab).forEach((c) => {
      const el = document.createElement('button');
      const unlocked = p.contractUnlocked(c);
      const stars = p.contractStars(c.id);
      el.className = 'contract-card' + (c.boss ? ' boss' : '') + (unlocked ? '' : ' locked') + (c === next && unlocked ? ' next' : '');
      el.style.setProperty('--rot', `${(Math.random() * 4 - 2).toFixed(1)}deg`);
      el.innerHTML = `<div class="cc-num">Contract ${CONTRACTS.indexOf(c) + 1}</div><div class="cc-type">${OBJECTIVE_LABEL[c.objective.type]}</div>` +
        `<div class="cc-name">${c.name}</div><div class="cc-reward">${fmtMoney(c.reward)}</div>` +
        `<div class="cc-stars">${[1, 2, 3].map((s) => `<i class="ico ico-star ${s <= stars ? 'on' : ''}"></i>`).join('')}</div>`;
      el.addEventListener('click', () => {
        if (!unlocked) { this.toastMenu(p.territoryUnlocked(c.territory) ? 'Finish the previous contract first' : `Earn ${TERRITORIES[c.territory].starsRequired} stars to open ${TERRITORIES[c.territory].name}`); return; }
        this.openBriefing(c);
      });
      grid.appendChild(el);
    });
  }

  openBriefing(c) {
    if (!c) return;
    const p = this.game.profile;
    this.briefContract = c;
    const t = TERRITORIES[c.territory];
    $('briefTerritory').textContent = `${t.name} · ${TIME_LABEL[t.time]}`;
    $('briefTitle').textContent = c.name;
    $('briefText').textContent = c.brief;
    const o = c.objective;
    const objText = {
      eliminate: `Eliminate ${o.count} outlaws`, escape: `Stop the getaway — no more than ${o.maxEscape} may escape`,
      hostage: `Kill the ${o.count} hostage takers before their timers run out`, boss: 'Thin out the gang, then kill the Wanted boss',
      train: `Kill ${o.count} outlaws before the train leaves`,
    }[o.type];
    $('briefObjective').textContent = objText;
    $('briefReward').textContent = fmtMoney(c.reward);
    $('briefAmmo').textContent = c.ammo + Math.round(p.upgradeValue('bandolier'));
    $('briefWind').textContent = c.wind ? `${c.wind[0]}–${c.wind[1]} m/s` : 'Calm';
    $('briefRifle').textContent = p.rifle().name.split(' ')[0];
    const st = c.stars;
    const have = p.contractStars(c.id);
    $('briefStars').innerHTML = [
      'Complete the contract', `Accuracy of ${Math.round(st.accuracy * 100)}% or better`, `${st.headshots} headshots or more`,
    ].map((txt, i) => `<div class="${i < have ? 'on' : ''}"><i class="ico ico-star"></i>${txt}</div>`).join('');
    const boss = c.boss ? this.game.bossDef(c.boss) : null;
    $('posterName').textContent = boss ? boss.name : 'The Gang';
    $('posterReward').textContent = `${fmtMoney(boss ? boss.bounty : c.reward)} REWARD`;
    this.game.drawPortrait($('portrait'), c.boss);
    this.show('briefing');
  }

  // ---------------------------------------------------------------- gunsmith
  renderGunsmith(tab) {
    if (tab) this.gunTab = tab;
    tab = this.gunTab || 'rifles';
    const p = this.game.profile;
    document.querySelectorAll('#gunsmith .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $('tab-rifles').classList.toggle('hidden', tab !== 'rifles');
    $('tab-upgrades').classList.toggle('hidden', tab !== 'upgrades');
    document.querySelectorAll('.cash-val').forEach((el) => (el.textContent = fmtMoney(p.cash)));
    const grid = $('rifleGrid');
    grid.innerHTML = '';
    for (const r of RIFLES) {
      const owned = p.ownsRifle(r.id);
      const eq = p.data.equipped === r.id;
      const card = document.createElement('div');
      card.className = 'rifle-card' + (eq ? ' equipped' : '');
      const bar = (label, v) => `<div class="stat-row"><span>${label}</span><div class="sb"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
      card.innerHTML = `<div class="rc-img"><canvas width="360" height="140"></canvas></div><div class="rc-name">${r.name}</div><div class="rc-desc">${r.desc}</div>` +
        bar('Zoom', r.zoom[r.zoom.length - 1] / 12) + bar('Power', r.damage / 260) + bar('Stability', 1 - (r.sway - 0.5) / 0.6) + bar('Velocity', (r.velocity - 300) / 360) + bar('Magazine', r.mag / 6);
      const btn = document.createElement('button');
      btn.className = 'btn ' + (eq ? 'btn-dark' : owned ? 'btn-leather' : 'btn-gold');
      btn.innerHTML = eq ? '<i class="ico ico-check"></i>Equipped' : owned ? 'Equip' : `<img src="assets/images/icons/coin.png" style="width:24px">${fmtMoney(r.price)}`;
      if (eq) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (owned) { p.equip(r.id); this.renderGunsmith(); return; }
        if (p.buyRifle(r.id)) { this.game.audio.play('cash'); this.toastMenu(`${r.name} purchased!`); this.renderGunsmith(); } else this.toastMenu('Not enough cash, partner.');
      });
      card.appendChild(btn);
      grid.appendChild(card);
      this.game.drawRifleThumb(card.querySelector('canvas'), r.model);
    }
    const list = $('upgradeList');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = p.upgradeLevel(u.id);
      const cost = p.upgradeCost(u.id);
      const row = document.createElement('div');
      row.className = 'upgrade-row';
      row.innerHTML = `<div class="ur-icon"><i class="ico ico-${u.icon}"></i></div><div><div class="ur-name">${u.name}</div><div class="ur-desc">${u.desc}</div></div>` +
        `<div class="pips">${u.costs.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn ' + (cost == null ? 'btn-dark' : 'btn-gold');
      btn.innerHTML = cost == null ? 'Maxed' : `<img src="assets/images/icons/coin.png" style="width:24px">${fmtMoney(cost)}`;
      btn.disabled = cost == null;
      btn.addEventListener('click', () => {
        if (p.buyUpgrade(u.id)) { this.game.audio.play('cash'); this.renderGunsmith(); } else this.toastMenu('Not enough cash, partner.');
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- bounty board
  renderBounty() {
    const p = this.game.profile;
    p.refreshChallenges();
    document.querySelectorAll('.cash-val').forEach((el) => (el.textContent = fmtMoney(p.cash)));
    const now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const hrs = Math.ceil((tomorrow - now) / 3600000);
    $('challengeReset').textContent = `New bounties in ${hrs}h`;
    const list = $('challengeList');
    list.innerHTML = '';
    p.data.challenges.list.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'challenge' + (c.claimed ? ' claimed' : '');
      const done = c.progress >= c.target;
      el.innerHTML = `<div class="c-text">${c.text} <small style="opacity:.7">(${c.progress}/${c.target})</small></div><div class="c-bar"><i style="width:${(c.progress / c.target) * 100}%"></i></div>`;
      const b = document.createElement('button');
      b.className = 'btn btn-small ' + (done && !c.claimed ? 'btn-gold' : 'btn-dark');
      b.innerHTML = c.claimed ? '<i class="ico ico-check"></i>Done' : fmtMoney(c.reward);
      b.disabled = !done || c.claimed;
      b.addEventListener('click', () => { const amt = p.claimChallenge(i); if (amt) { this.game.audio.play('cash'); this.toastMenu(`+${fmtMoney(amt)}`); this.renderBounty(); } });
      el.appendChild(b);
      list.appendChild(el);
    });
    const ds = p.dailyStatus();
    const streak = ds.available ? ds.day - 1 : p.data.daily.streak;
    $('streakRow').innerHTML = DAILY_REWARDS.map((amt, i) => `<div class="day ${i < streak ? 'got' : ''} ${ds.available && i === ds.day - 1 ? 'today' : ''}">Day ${i + 1}<b>${fmtMoney(amt)}</b></div>`).join('');
    if (ds.available) {
      const b = document.createElement('button');
      b.className = 'btn btn-gold btn-small';
      b.style.marginTop = '8px';
      b.textContent = `Claim ${fmtMoney(ds.amount)}`;
      b.addEventListener('click', () => { p.claimDaily(); this.game.audio.play('cash'); this.renderBounty(); });
      $('streakRow').after(b);
      this._claimBtn?.remove();
      this._claimBtn = b;
    } else { this._claimBtn?.remove(); }
    const s = p.data.stats;
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    $('careerStats').innerHTML = [['Outlaws', s.kills], ['Headshots', s.headshots], ['Accuracy', acc + '%'], ['Longest', Math.round(s.longest) + 'm'], ['Contracts', s.contracts], ['Earned', fmtMoney(s.totalEarned)]]
      .map(([l, v]) => `<div><label>${l}</label><b>${v}</b></div>`).join('');
    const got = ACHIEVEMENTS.filter((a) => p.data.achievements[a.id]).length;
    $('achCount').textContent = `${got}/${ACHIEVEMENTS.length}`;
    $('achGrid').innerHTML = ACHIEVEMENTS.map((a) => `<div class="ach ${p.data.achievements[a.id] ? 'got' : ''}"><div class="a-name"><i class="ico ico-trophy"></i>${a.name}</div><div class="a-desc">${a.desc}</div><div class="a-rew">+${fmtMoney(a.reward)}</div></div>`).join('');
  }

  // ---------------------------------------------------------------- settings
  buildSettings() {
    const groups = [
      ['Audio', [['master', 'Master volume', 'range', 0, 1, 0.05], ['music', 'Music', 'range', 0, 1, 0.05], ['sfx', 'Sound effects', 'range', 0, 1, 0.05]]],
      ['Controls', [['sensitivity', 'Mouse sensitivity', 'range', 0.2, 3, 0.05], ['scopeSensitivity', 'Scoped sensitivity', 'range', 0.2, 2, 0.05], ['invertY', 'Invert Y axis', 'toggle'], ['holdToScope', 'Hold to scope (off = toggle)', 'toggle']]],
      ['Graphics', [['quality', 'Quality', 'seg', ['low', 'medium', 'high', 'ultra']], ['fov', 'Field of view', 'range', 50, 80, 1], ['showFps', 'Show FPS', 'toggle']]],
      ['Gameplay', [['bulletCam', 'Bullet cam', 'toggle'], ['screenShake', 'Screen shake', 'toggle'], ['hints', 'Tutorial hints', 'toggle']]],
    ];
    const body = $('settingsBody');
    this.settingControls = {};
    for (const [title, rows] of groups) {
      const g = document.createElement('div');
      g.className = 'set-group';
      g.innerHTML = `<h4>${title}</h4>`;
      for (const [key, label, type, a, b, step] of rows) {
        const row = document.createElement('div');
        row.className = 'set-row';
        row.innerHTML = `<span>${label}</span>`;
        let ctl;
        const out = document.createElement('output');
        if (type === 'range') {
          ctl = document.createElement('input');
          Object.assign(ctl, { type: 'range', min: a, max: b, step });
          ctl.addEventListener('input', () => this.setSetting(key, parseFloat(ctl.value)));
        } else if (type === 'toggle') {
          ctl = document.createElement('button');
          ctl.className = 'toggle';
          ctl.addEventListener('click', () => this.setSetting(key, !this.game.profile.settings[key]));
        } else {
          ctl = document.createElement('div');
          ctl.className = 'seg';
          for (const opt of a) {
            const sb = document.createElement('button');
            sb.textContent = opt;
            sb.dataset.v = opt;
            sb.addEventListener('click', () => this.setSetting(key, opt));
            ctl.appendChild(sb);
          }
        }
        row.appendChild(ctl);
        row.appendChild(out);
        g.appendChild(row);
        this.settingControls[key] = { ctl, out, type };
      }
      body.appendChild(g);
    }
  }
  setSetting(key, v) {
    const s = this.game.profile.settings;
    s[key] = v;
    this.game.profile.save();
    this.game.applySettings();
    this.syncSettings();
  }
  syncSettings() {
    const s = this.game.profile.settings;
    for (const [key, { ctl, out, type }] of Object.entries(this.settingControls)) {
      if (type === 'range') {
        ctl.value = s[key];
        out.textContent = ['master', 'music', 'sfx'].includes(key) ? Math.round(s[key] * 100) : key === 'fov' ? `${s[key]}°` : (+s[key]).toFixed(2);
      } else if (type === 'toggle') ctl.classList.toggle('on', !!s[key]);
      else ctl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s[key]));
    }
  }

  // ---------------------------------------------------------------- results
  showResults(r) {
    this.lastResult = r;
    const box = document.querySelector('.results-box');
    box.classList.toggle('win', r.success);
    $('resultsTitle').textContent = r.showdown ? 'Showdown Over' : r.success ? 'Bounty Collected' : 'Contract Failed';
    $('resultsSub').textContent = r.showdown ? `You survived to wave ${r.wave}${r.newBest ? ' — new personal best!' : ''}` : r.success ? `${r.contract.name} — ${TERRITORIES[r.contract.territory].name}` : r.reason;
    const stars = [...document.querySelectorAll('.rstar')];
    stars.forEach((s) => s.classList.remove('on'));
    $('resultsStars').classList.toggle('hidden', !!r.showdown);
    stars.forEach((s, i) => { if (i < r.stars) setTimeout(() => { s.classList.add('on'); this.game.audio.play('star', { rate: 1 + i * 0.12 }); }, 500 + i * 450); });
    const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
    const rows = [['Outlaws down', r.kills], ['Headshots', r.headshots], ['Accuracy', `${acc}%`], ['Longest shot', `${Math.round(r.longest)} m`], ['Best streak', `x${Math.max(1, r.bestCombo)}`], ['Time', fmtTime(r.time)]];
    if (r.escapes) rows.push(['Escaped', r.escapes]);
    if (r.civiliansDown) rows.push(['Civilians hit', r.civiliansDown]);
    $('resultsStats').innerHTML = rows.map(([l, v], i) => `<div style="animation-delay:${i * 0.06}s"><span>${l}</span><b>${v}</b></div>`).join('');
    $('resultsBreakdown').innerHTML = r.breakdown.map((b, i) => `<div style="animation-delay:${0.3 + i * 0.08}s"><span>${b.label}</span><b class="${b.amount < 0 ? 'neg' : ''}">${b.amount < 0 ? '-' : '+'}${fmtMoney(Math.abs(b.amount))}</b></div>`).join('');
    // count-up total
    const total = r.total;
    const el = $('resultsTotal');
    const t0 = performance.now();
    const tick = () => {
      const k = clamp((performance.now() - t0) / 1400, 0, 1);
      el.textContent = fmtMoney(total * easeOutCubic(k));
      if (k < 1) requestAnimationFrame(tick); else if (total > 0) this.game.audio.play('cash', { volume: 0.7 });
    };
    tick();
    const extra = $('resultsExtra');
    extra.innerHTML = '';
    if (r.rankUp) extra.innerHTML += `<div class="rank-up">⭐ Promoted to <b>${r.rankUp.name}</b>!</div>`;
    for (const a of r.achievements || []) extra.innerHTML += `<div class="ach-pop">🏆 Achievement: <b>${a.name}</b> (+${fmtMoney(a.reward)})</div>`;
    if (r.unlocked) extra.innerHTML += `<div class="rank-up">🗺 New territory opened: <b>${r.unlocked}</b></div>`;
    $('btnResNext').innerHTML = r.showdown ? '<i class="ico ico-reload"></i>Ride Again' : r.success ? '<i class="ico ico-play"></i>Next Contract' : '<i class="ico ico-map"></i>Briefing';
    this.show('results', { push: false });
    box.scrollTop = 0;
    requestAnimationFrame(() => { box.scrollTop = 0; });
  }

  // ---------------------------------------------------------------- HUD
  setHUD(on) {
    $('hud').classList.toggle('hidden', !on);
    if (!on) { this.hint(null); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    $('killfeed').innerHTML = '';
    $('toasts').innerHTML = '';
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.W = w; this.H = h;
  }

  banner(title, sub = '', gold = false) {
    const b = $('banner');
    b.classList.remove('hidden', 'gold');
    if (gold) b.classList.add('gold');
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-sub').textContent = sub;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.add('hidden'), 2600);
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  killPopup(title, tags, amount, head, bad = false) {
    const k = document.createElement('div');
    k.className = 'kill-pop' + (head ? ' head' : '') + (bad ? ' bad' : '');
    k.innerHTML = `<div class="k-title">${title}</div>${tags.length ? `<div class="k-tags">${tags.join(' · ')}</div>` : ''}<div class="k-cash">${amount < 0 ? '-' : '+'}${fmtMoney(Math.abs(amount))}</div>`;
    const feed = $('killfeed');
    feed.prepend(k);
    while (feed.children.length > 3) feed.lastChild.remove();
    setTimeout(() => k.remove(), 1800);
    $('hudObj').classList.remove('pulse'); void $('hudObj').offsetWidth; $('hudObj').classList.add('pulse');
  }

  hint(html) {
    const h = $('hint');
    if (!html) { h.classList.add('hidden'); this._hint = null; return; }
    if (this._hint === html) return;
    this._hint = html;
    h.innerHTML = html;
    h.classList.remove('hidden');
    h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
  }

  hitmarker(killed, head) { this.hits.push({ t: 0, killed, head }); }
  ammoRefund() {
    const el = $('hudReserve').parentElement;
    el.classList.remove('refund'); void el.offsetWidth; el.classList.add('refund');
  }
  onFire() { this.fireT = 0; }
  damage(angle, intensity) {
    this.damageArcs.push({ angle, t: 0, intensity });
    if (intensity > 0) $('fxHurt').style.opacity = clamp(0.4 + intensity, 0, 1);
  }
  flash(kind) {
    if (kind === 'deadeye') { /* the overlay class is driven from updateHUD */ }
  }
  setBulletCam(on) {
    $('letterbox').classList.toggle('on', on);
    $('hud').classList.toggle('cinematic', on);
  }

  updateHUD(dt) {
    const g = this.game, c = g.combat, m = g.mission;
    if (!m.active) return;
    const info = m.objectiveInfo();
    $('objTitle').textContent = info.text;
    $('objProgress').textContent = info.progress || '';
    $('objSub').textContent = info.sub || '';
    // boss bar
    const boss = m.boss;
    $('hudBoss').classList.toggle('hidden', !(boss && boss.alive));
    if (boss && boss.alive) { $('bossName').textContent = boss.bossName; $('bossFill').style.width = `${(boss.hp / boss.maxHp) * 100}%`; }
    // cash, time, combo
    if (m.cash !== this.lastCash) {
      $('hudCash').textContent = fmtMoney(m.cash);
      const el = $('hudCash').parentElement; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      this.lastCash = m.cash;
    }
    $('hudTime').textContent = fmtTime(m.time);
    $('hudCombo').classList.toggle('hidden', m.combo < 2);
    $('hudCombo').textContent = `x${m.combo} STREAK`;
    // health
    const hp = c.health / c.maxHealth;
    $('hpFill').style.width = `${hp * 100}%`;
    $('hpGhost').style.width = `${hp * 100}%`;
    document.querySelector('.hud-health').classList.toggle('low', hp < 0.35);
    $('deFill').style.width = `${c.deadEyeMeter * 100}%`;
    $('hudDeadeye').classList.toggle('ready', c.deadEyeMeter >= 0.3 && !c.deadEye);
    $('brFill').style.width = `${c.breath * 100}%`;
    $('hudBreath').classList.toggle('show', c.scopeT > 0.5);
    $('hudBreath').classList.toggle('locked', c.breathLocked);
    $('hudZoom').classList.toggle('show', c.scopeT > 0.5);
    $('hudZoom').textContent = `${c.zoom}×`;
    // ammo
    const mag = $('hudMag');
    if (mag.children.length !== c.rifle.mag) mag.innerHTML = '<i></i>'.repeat(c.rifle.mag);
    [...mag.children].forEach((b, i) => b.classList.toggle('spent', i >= c.mag));
    $('hudReserve').textContent = c.reserve;
    $('hudReserve').parentElement.classList.toggle('empty', c.reserve === 0);
    $('hudReload').classList.toggle('hidden', !c.reloading);
    // wind
    const w = g.world.wind;
    const ws = Math.hypot(w.x, w.y);
    $('windVal').textContent = ws < 0.3 ? 'Calm' : `${ws.toFixed(1)} m/s`;
    const windAng = Math.atan2(w.x, -w.y) + c.yaw;
    $('windArrow').style.transform = `rotate(${(windAng * 180) / Math.PI - 90}deg)`;
    $('windArrow').style.opacity = ws < 0.3 ? 0.2 : 1;
    // effects
    const hurt = $('fxHurt');
    const target = Math.max(c.hurtFlash * 0.8, hp < 0.35 ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0);
    hurt.style.opacity = target.toFixed(3);
    $('fxDeadeye').classList.toggle('on', c.deadEye);
    document.body.classList.toggle('deadeye', c.deadEye);
    $('clickToAim').classList.toggle('hidden', g.input.locked || g.state !== 'playing' || !g.wantsLock);
    // fps
    if (g.profile.settings.showFps) {
      this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc > 0.5) { $('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS`; this.fpsAcc = 0; this.fpsN = 0; }
    }
    $('fps').classList.toggle('hidden', !g.profile.settings.showFps);
    this.drawOverlay(dt);
  }

  // ---------------------------------------------------------------- overlay canvas
  drawOverlay(dt) {
    const g = this.game, c = g.combat, ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (c.bulletCam || g.state === 'intro') return;
    const k = easeOutCubic(c.scopeT);
    const cx = W / 2, cy = H / 2;
    this.drawMarkers(ctx, W, H, k);
    if (k > 0.01) this.drawScope(ctx, W, H, cx, cy, k);
    else this.drawCrosshair(ctx, cx, cy);
    // hitmarkers
    for (const h of this.hits) {
      h.t += dt;
      const a = 1 - h.t / 0.35;
      if (a <= 0) continue;
      const s = 10 + h.t * 30;
      ctx.strokeStyle = h.head ? `rgba(255,160,60,${a})` : h.killed ? `rgba(255,70,50,${a})` : `rgba(255,240,220,${a})`;
      ctx.lineWidth = h.killed ? 3 : 2;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { ctx.moveTo(cx + dx * s * 0.45, cy + dy * s * 0.45); ctx.lineTo(cx + dx * s, cy + dy * s); }
      ctx.stroke();
    }
    this.hits = this.hits.filter((h) => h.t < 0.35);
    // damage direction arcs
    for (const d of this.damageArcs) {
      d.t += dt;
      const a = 1 - d.t / 1.6;
      if (a <= 0) continue;
      const ang = d.angle - Math.PI / 2;
      ctx.strokeStyle = d.intensity > 0 ? `rgba(255,40,20,${a * 0.9})` : `rgba(255,220,180,${a * 0.5})`;
      ctx.lineWidth = d.intensity > 0 ? 8 : 4;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(W, H) * 0.2, ang - 0.28, ang + 0.28);
      ctx.stroke();
    }
    this.damageArcs = this.damageArcs.filter((d) => d.t < 1.6);
  }

  drawCrosshair(ctx, cx, cy) {
    const spread = 8 + (this.fireT != null && this.fireT < 0.3 ? (0.3 - this.fireT) * 40 : 0);
    if (this.fireT != null) this.fireT += 1 / 60;
    ctx.lineWidth = 2;
    for (const [col, w] of [['rgba(0,0,0,.6)', 4], ['rgba(255,240,220,.95)', 2]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(cx - spread - 10, cy); ctx.lineTo(cx - spread, cy);
      ctx.moveTo(cx + spread, cy); ctx.lineTo(cx + spread + 10, cy);
      ctx.moveTo(cx, cy - spread - 10); ctx.lineTo(cx, cy - spread);
      ctx.moveTo(cx, cy + spread); ctx.lineTo(cx, cy + spread + 10);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff5a3a';
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
  }

  drawScope(ctx, W, H, cx, cy, k) {
    const g = this.game, c = g.combat;
    const R = Math.min(W, H) * 0.47 * (0.88 + 0.12 * k);
    ctx.save();
    ctx.globalAlpha = k;
    // mask outside the lens
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, R, 0, Math.PI * 2, true); ctx.fill();
    // lens edge shadow + subtle chromatic ring
    let grd = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.85, 'rgba(0,0,0,.35)'); grd.addColorStop(1, 'rgba(0,0,0,.95)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,60,.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(80,160,255,.18)';
    ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2); ctx.stroke();
    // lens glare
    grd = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 0, cx - R * 0.35, cy - R * 0.4, R * 0.7);
    grd.addColorStop(0, 'rgba(255,240,220,.07)'); grd.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // reticle
    const night = g.world.timeName !== 'noon';
    const ret = 'rgba(10,8,6,.95)';
    ctx.strokeStyle = ret; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx - R * 0.42, cy); ctx.moveTo(cx + R * 0.42, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy + R); ctx.lineTo(cx, cy + R * 0.42); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy - R * 0.55);
    ctx.stroke();
    // bullet-drop ticks for 100..300 m (+ wind hold dots)
    const fov = (g.camera.fov * Math.PI) / 180;
    const pxPerRad = H / (2 * Math.tan(fov / 2));
    const v = c.rifle.velocity;
    const w = g.world.wind;
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const windSide = w.x * right.x + w.y * right.z;
    ctx.font = `600 ${Math.round(clamp(R * 0.035, 11, 16))}px Teko, sans-serif`;
    ctx.fillStyle = ret;
    ctx.lineWidth = 1.6;
    for (const d of [100, 150, 200, 250, 300]) {
      const t = d / v;
      const drop = 0.5 * GRAVITY * t * t;
      const y = cy + (drop / d) * pxPerRad;
      if (y > cy + R * 0.4) break;
      const major = d % 100 === 0;
      const half = major ? 16 : 7;
      ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
      if (major && y - cy > 5) {
        ctx.textAlign = d === 200 ? 'left' : 'right';
        ctx.fillText(String(d / 100), d === 200 ? cx + half + 4 : cx - half - 4, y + 5);
        ctx.textAlign = 'start';
      }
      if (major && Math.abs(windSide) > 0.3 && y - cy > 4) {
        const drift = 0.5 * windSide * WIND_ACCEL * t * t;
        const x = cx - (drift / d) * pxPerRad;
        ctx.fillStyle = night ? '#ff6a3a' : '#c0200c';
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ret;
      }
    }
    // illuminated centre dot
    ctx.fillStyle = night ? '#ff3a1a' : '#d0200c';
    ctx.shadowColor = '#ff3a1a'; ctx.shadowBlur = night ? 8 : 3;
    ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // range + zoom readouts
    ctx.font = `600 ${Math.round(clamp(R * 0.06, 16, 28))}px Teko, sans-serif`;
    ctx.fillStyle = 'rgba(255,230,190,.9)';
    ctx.textAlign = 'right';
    ctx.fillText(c.rangefinder ? `${Math.round(c.rangefinder)} m` : '--- m', cx - R * 0.48, cy + R * 0.62);
    ctx.textAlign = 'left';
    ctx.fillText(`${c.zoom}×`, cx + R * 0.48, cy + R * 0.62);
    ctx.textAlign = 'start';
    // breath arc
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, Math.PI * 0.7, Math.PI * 1.3); ctx.stroke();
    ctx.strokeStyle = c.breathLocked ? '#c0503a' : c.holdingBreath ? '#a8d4ff' : 'rgba(168,212,255,.55)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, Math.PI * 1.3 - Math.PI * 0.6 * c.breath, Math.PI * 1.3); ctx.stroke();
    ctx.restore();
  }

  drawMarkers(ctx, W, H, scopeK) {
    const g = this.game, m = g.mission, cam = g.camera;
    const now = performance.now() / 1000;
    for (const a of m.actors) {
      if (!a.alive || a.removed) continue;
      const head = a.rig.j.head.getWorldPosition(_p).add({ x: 0, y: 0.55, z: 0 });
      const s = toScreen(head, cam, W, H, _s);
      if (a.enemy && a.state === 'aim' && a.aimProgress > 0.05 && a.cfg.shootBack) {
        if (s && s.inside) {
          const r = 12 + scopeK * 10;
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,.5)';
          ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = a.aimProgress > 0.75 ? `rgba(255,${Math.floor(60 + Math.sin(now * 30) * 40)},30,1)` : 'rgba(255,90,40,.95)';
          ctx.beginPath(); ctx.arc(s.x, s.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.aimProgress); ctx.stroke();
          ctx.fillStyle = '#ff5a3a';
          ctx.font = `700 ${Math.round(r)}px Teko, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('!', s.x, s.y + r * 0.35);
          ctx.textAlign = 'start';
        } else {
          // edge arrow toward an off-screen threat
          let nx = s ? s.ndcX : -Math.sign(head.x - cam.position.x) || 1, ny = s ? s.ndcY : 0;
          if (!s) { nx = -nx; }
          const ang = Math.atan2(-ny, nx);
          const ex = W / 2 + Math.cos(ang) * (W / 2 - 50), ey = H / 2 + Math.sin(ang) * (H / 2 - 50);
          ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
          ctx.fillStyle = `rgba(255,70,30,${0.5 + a.aimProgress * 0.5})`;
          ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      if (!s || !s.inside) continue;
      if (a.role === 'hostage' && a.timer > 0) {
        const k = clamp(a.timer / a.timerMax, 0, 1);
        const bw = 46;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(s.x - bw / 2 - 2, s.y - 14, bw + 4, 9);
        ctx.fillStyle = k > 0.5 ? '#8fae6a' : k > 0.25 ? '#f0bd62' : '#ff4a2a';
        ctx.fillRect(s.x - bw / 2, s.y - 12, bw * k, 5);
        ctx.font = '600 15px Teko, sans-serif'; ctx.fillStyle = '#ffe0c0'; ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(a.timer)}s`, s.x, s.y - 18); ctx.textAlign = 'start';
      }
      const mark = (col) => {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 2); ctx.lineTo(s.x - 6, s.y - 8); ctx.lineTo(s.x + 6, s.y - 8); ctx.closePath(); ctx.fill();
      };
      if (g.combat.deadEye && a.enemy && a.exposed) mark('rgba(255,60,20,.95)');
      else if (scopeK < 0.5 && a.enemy && ['runner', 'rider', 'train'].includes(a.role) && a.exposed) mark('rgba(255,150,60,.8)');
      if (a.boss && a.exposed && scopeK < 0.5) {
        ctx.font = '22px Rye, serif'; ctx.fillStyle = '#ffcf8a'; ctx.textAlign = 'center';
        ctx.fillText('☠', s.x, s.y - 10); ctx.textAlign = 'start';
      }
    }
  }
}

