// data.js — static game content (rifles, upgrades, territories, contracts, achievements)
// and the persistent player Profile (economy, unlocks, stars, daily rewards, challenges, settings).
import { Storage, dateKey, daysBetween, seededRandom, hashString, clamp } from './core.js';

export const TITLE = 'Cowboy Sniper Elite';
export const VERSION = '1.0.0';
const SAVE_KEY = 'cse_profile_v1';

// ------------------------------------------------------------------ rifles
export const RIFLES = [
  {
    id: 'carbine', name: 'Peacemaker Carbine', price: 0,
    desc: 'Reliable lever-action carbine with a brass 4× scope. Fast follow-up shots.',
    zoom: [2.5, 4], sway: 1.0, mag: 6, boltTime: 0.55, reloadTime: 2.2, damage: 100, velocity: 430, model: 'rifle_carbine',
  },
  {
    id: 'longhorn', name: 'Longhorn .45-70', price: 2400,
    desc: 'Heavy bolt-action hunting rifle. Hard-hitting 8× optics and a steadier hold.',
    zoom: [3, 5, 8], sway: 0.78, mag: 5, boltTime: 0.85, reloadTime: 2.6, damage: 160, velocity: 520, model: 'rifle_longhorn',
  },
  {
    id: 'sharps', name: 'Elite Sharps "Widowmaker"', price: 6800,
    desc: 'Legendary long-range single shot. 12× tube scope, flat trajectory, punches through two men.',
    zoom: [4, 8, 12], sway: 0.6, mag: 4, boltTime: 1.0, reloadTime: 2.9, damage: 260, velocity: 640, pierce: true, model: 'rifle_sharps',
  },
];

// ------------------------------------------------------------------ upgrades
export const UPGRADES = [
  { id: 'stability', name: 'Steady Hands', icon: 'hand', desc: 'Reduces scope sway.', costs: [300, 650, 1100, 1800, 2800], per: 0.12 },
  { id: 'breath', name: 'Iron Lungs', icon: 'lungs', desc: 'Hold your breath longer.', costs: [250, 550, 950, 1500, 2300], per: 0.9 },
  { id: 'reload', name: 'Quick Hands', icon: 'reload', desc: 'Faster bolt and reload.', costs: [300, 700, 1200, 1900, 2900], per: 0.1 },
  { id: 'armor', name: 'Leather Duster', icon: 'armor', desc: 'Take less damage from outlaws.', costs: [350, 750, 1300, 2100, 3200], per: 0.09 },
  { id: 'bandolier', name: 'Bandolier', icon: 'ammo', desc: '+2 spare rounds per contract.', costs: [200, 450, 800, 1300, 2000], per: 2 },
  { id: 'deadeye', name: 'Dead-Eye', icon: 'eye', desc: 'Longer Dead-Eye slow motion.', costs: [400, 850, 1400, 2200, 3400], per: 0.18 },
];

// ------------------------------------------------------------------ world
export const TERRITORIES = [
  { id: 'gulch', name: 'Dustwater Gulch', subtitle: 'A boomtown gone rotten', time: 'noon', layout: 'town', starsRequired: 0, color: '#e2a25a' },
  { id: 'junction', name: 'Red Mesa Junction', subtitle: 'Iron rails, red dust', time: 'sunset', layout: 'junction', starsRequired: 9, color: '#e0613a' },
  { id: 'ridge', name: 'Coyote Ridge', subtitle: 'Where lanterns burn till dawn', time: 'night', layout: 'ridge', starsRequired: 21, color: '#5c7ad6' },
];

export const BOSSES = {
  morrow: { name: '"Black Jack" Morrow', bounty: 900, hp: 3, coat: 0x1b1b1f, hat: 0x111111, shirt: 0x7a1d1d, bandana: 0x111111, crime: 'Train robbery, cattle rustling and cheating at cards.' },
  delgado: { name: '"Rattler" Kate Delgado', bounty: 1500, hp: 3, coat: 0x6b3f22, hat: 0x3c2a1a, shirt: 0xd9c7a0, bandana: 0xa02a2a, crime: 'Stagecoach heists across three territories.' },
  undertaker: { name: '"The Undertaker"', bounty: 3000, hp: 5, coat: 0x0e0e12, hat: 0x0a0a0a, shirt: 0x3a3a46, bandana: 0x6b0f0f, crime: 'Runs every outlaw gang from here to the border.' },
};

// Enemy archetype mix: window, roof, balcony, street, runner, rider, sniper, train, hostage
export const CONTRACTS = [
  // ---- Dustwater Gulch (noon)
  { id: 'c1', territory: 0, name: 'First Bounty', reward: 200, ammo: 12,
    brief: 'Three cattle thieves are holed up on Main Street. They don\'t know you\'re on the water tower. Make it count.',
    objective: { type: 'eliminate', count: 3 }, enemies: { mix: { window: 2, street: 1 }, maxActive: 2, shootBack: false }, civilians: 3, tutorial: true,
    stars: { accuracy: 0.6, headshots: 2 } },
  { id: 'c2', territory: 0, name: 'Saloon Brawl', reward: 350, ammo: 14,
    brief: 'A drunk gang shot up the Lucky Spur saloon. They will return fire — watch for the red warning.',
    objective: { type: 'eliminate', count: 6 }, enemies: { mix: { window: 3, balcony: 2, street: 2, roof: 1 }, maxActive: 3, shootBack: true, aim: [3.2, 4.4], accuracy: 0.45, damage: 14 }, civilians: 4,
    stars: { accuracy: 0.6, headshots: 3 } },
  { id: 'c3', territory: 0, name: 'Bank Run', reward: 450, ammo: 14,
    brief: 'The Dustwater Bank is being robbed! Robbers will sprint for their horses at the edge of town. Stop them.',
    objective: { type: 'escape', count: 6, maxEscape: 2 }, enemies: { mix: { runner: 5, window: 1 }, maxActive: 3, shootBack: true, aim: [3, 4], accuracy: 0.4, damage: 14 }, civilians: 3,
    stars: { accuracy: 0.6, headshots: 3 } },
  { id: 'c4', territory: 0, name: 'Hotel Hostages', reward: 550, ammo: 14,
    brief: 'Outlaws hold hostages at the Grand Hotel. Each one has a short fuse. Do NOT hit the hostages.',
    objective: { type: 'hostage', count: 3, timer: 26 }, enemies: { mix: { hostage: 3, window: 2, roof: 1 }, maxActive: 4, shootBack: true, aim: [3, 4], accuracy: 0.45, damage: 15 }, civilians: 2, civilianLimit: 1,
    stars: { accuracy: 0.65, headshots: 3 } },
  { id: 'c5', territory: 0, name: 'WANTED: Black Jack', reward: 900, ammo: 18, boss: 'morrow',
    brief: '"Black Jack" Morrow rode into town with his crew. Thin out his men, then put the Jack of Spades in the dirt.',
    objective: { type: 'boss', count: 7 }, enemies: { mix: { window: 2, roof: 2, street: 2, balcony: 1 }, maxActive: 3, shootBack: true, aim: [2.8, 3.8], accuracy: 0.5, damage: 16 }, civilians: 3,
    stars: { accuracy: 0.65, headshots: 4 } },
  // ---- Red Mesa Junction (sunset, wind)
  { id: 'c6', territory: 1, name: 'Dust on the Rails', reward: 650, ammo: 16, wind: [1.5, 3],
    brief: 'Outlaws took the Red Mesa depot. Mind the crosswind at long range — check the wind flag in your HUD.',
    objective: { type: 'eliminate', count: 8 }, enemies: { mix: { window: 2, roof: 2, street: 3, sniper: 1 }, maxActive: 3, shootBack: true, aim: [2.8, 3.8], accuracy: 0.5, damage: 16 }, civilians: 3,
    stars: { accuracy: 0.65, headshots: 4 } },
  { id: 'c7', territory: 1, name: 'The 4:15 Express', reward: 800, ammo: 18, wind: [1, 2.5],
    brief: 'Bandits are riding the roof of the Express through the junction. Lead your shots — the train won\'t wait.',
    objective: { type: 'train', count: 5, total: 8 }, enemies: { mix: { train: 8 }, maxActive: 8, shootBack: true, aim: [3, 4.2], accuracy: 0.45, damage: 15 }, civilians: 0,
    stars: { accuracy: 0.6, headshots: 3 } },
  { id: 'c8', territory: 1, name: 'Dynamite Gang', reward: 900, ammo: 20, wind: [1.5, 3.5],
    brief: 'The Powder Boys are running dynamite at the station. Red barrels go boom — use them.',
    objective: { type: 'escape', count: 8, maxEscape: 2 }, enemies: { mix: { runner: 6, street: 2, roof: 1 }, maxActive: 4, shootBack: true, aim: [2.8, 3.8], accuracy: 0.5, damage: 16 }, civilians: 2, barrels: 5,
    stars: { accuracy: 0.6, headshots: 4 } },
  { id: 'c9', territory: 1, name: 'Riders on the Ridge', reward: 1000, ammo: 20, wind: [2, 4],
    brief: 'A posse of raiders is galloping for the canyon pass. Knock them out of the saddle before they get away.',
    objective: { type: 'escape', count: 8, maxEscape: 2 }, enemies: { mix: { rider: 7, sniper: 1 }, maxActive: 3, shootBack: true, aim: [3, 4], accuracy: 0.45, damage: 16 }, civilians: 0,
    stars: { accuracy: 0.6, headshots: 3 } },
  { id: 'c10', territory: 1, name: 'WANTED: Rattler Kate', reward: 1500, ammo: 20, wind: [2, 4], boss: 'delgado',
    brief: '"Rattler" Kate Delgado and her snipers hold the junction. Look for the glint of their scopes.',
    objective: { type: 'boss', count: 9 }, enemies: { mix: { sniper: 3, window: 2, roof: 2, street: 2 }, maxActive: 4, shootBack: true, aim: [2.6, 3.5], accuracy: 0.55, damage: 18 }, civilians: 2,
    stars: { accuracy: 0.65, headshots: 5 } },
  // ---- Coyote Ridge (night)
  { id: 'c11', territory: 2, name: 'Lanterns Out', reward: 1100, ammo: 18, wind: [0.5, 2],
    brief: 'Night falls on Coyote Ridge. Muzzle flashes give the outlaws away — so does yours.',
    objective: { type: 'eliminate', count: 10 }, enemies: { mix: { window: 4, roof: 2, balcony: 2, street: 3 }, maxActive: 4, shootBack: true, aim: [2.6, 3.6], accuracy: 0.55, damage: 17 }, civilians: 2,
    stars: { accuracy: 0.65, headshots: 5 } },
  { id: 'c12', territory: 2, name: 'Glint in the Dark', reward: 1200, ammo: 14, wind: [1, 3],
    brief: 'Six marksmen on the ridge. Watch for the moonlight glinting off their glass — and shoot first.',
    objective: { type: 'eliminate', count: 6 }, enemies: { mix: { sniper: 6 }, maxActive: 3, shootBack: true, aim: [3, 4], accuracy: 0.6, damage: 24 }, civilians: 0,
    stars: { accuracy: 0.7, headshots: 4 } },
  { id: 'c13', territory: 2, name: 'Midnight Stage', reward: 1300, ammo: 18, wind: [1, 2.5],
    brief: 'The midnight stage was stopped at the edge of town. Free the passengers — quickly and cleanly.',
    objective: { type: 'hostage', count: 4, timer: 24 }, enemies: { mix: { hostage: 4, window: 2, roof: 2 }, maxActive: 5, shootBack: true, aim: [2.6, 3.6], accuracy: 0.55, damage: 17 }, civilians: 1, civilianLimit: 1,
    stars: { accuracy: 0.7, headshots: 4 } },
  { id: 'c14', territory: 2, name: 'Gold Wagon Ambush', reward: 1400, ammo: 22, wind: [1.5, 3.5],
    brief: 'Claim jumpers stole the mine\'s gold and are fleeing on horseback and on foot. Nobody leaves Coyote Ridge.',
    objective: { type: 'escape', count: 10, maxEscape: 2 }, enemies: { mix: { rider: 5, runner: 4, roof: 2 }, maxActive: 4, shootBack: true, aim: [2.6, 3.6], accuracy: 0.55, damage: 18 }, civilians: 2, barrels: 3,
    stars: { accuracy: 0.65, headshots: 5 } },
  { id: 'c15', territory: 2, name: 'WANTED: The Undertaker', reward: 3000, ammo: 24, wind: [1.5, 4], boss: 'undertaker',
    brief: 'The man who buries the law. His whole gang guards him. End it tonight, Marshal.',
    objective: { type: 'boss', count: 12 }, enemies: { mix: { window: 3, roof: 3, balcony: 2, street: 3, sniper: 2 }, maxActive: 5, shootBack: true, aim: [2.4, 3.3], accuracy: 0.6, damage: 19 }, civilians: 2, barrels: 3,
    stars: { accuracy: 0.7, headshots: 6 } },
];

// Showdown (endless) mode: waves scale with this table.
export const SHOWDOWN = {
  unlockAfter: 'c3',
  waveSize: (w) => 3 + Math.floor(w * 1.4),
  maxActive: (w) => Math.min(6, 2 + Math.floor(w / 2)),
  aim: (w) => [Math.max(1.8, 3.6 - w * 0.12), Math.max(2.6, 4.6 - w * 0.12)],
  accuracy: (w) => Math.min(0.75, 0.4 + w * 0.03),
  damage: (w) => Math.min(26, 12 + w),
  mix: (w) => ({ window: 3, roof: 2, street: 2, balcony: 1, runner: w > 2 ? 1 : 0, sniper: w > 4 ? 1 : 0 }),
  ammoPerWave: (w) => 6 + Math.floor(w * 1.6),
  waveBonus: (w) => 100 + w * 60,
};

export const RANKS = [
  { xp: 0, name: 'Greenhorn' }, { xp: 400, name: 'Ranch Hand' }, { xp: 1100, name: 'Deputy' },
  { xp: 2400, name: 'Bounty Hunter' }, { xp: 4500, name: 'Gunslinger' }, { xp: 7500, name: 'Sheriff' },
  { xp: 11500, name: 'Marshal' }, { xp: 17000, name: 'Dead Shot' }, { xp: 25000, name: 'Legend of the West' },
];

export const DAILY_REWARDS = [100, 150, 250, 350, 500, 700, 1200];

export const CHALLENGE_POOL = [
  { id: 'hs', text: 'Land {n} headshots', stat: 'headshots', n: [6, 10, 15], reward: [200, 320, 450] },
  { id: 'kills', text: 'Take down {n} outlaws', stat: 'kills', n: [12, 20, 30], reward: [180, 300, 420] },
  { id: 'long', text: 'Make {n} long shots (150m+)', stat: 'longshots', n: [3, 5, 8], reward: [220, 340, 480] },
  { id: 'contracts', text: 'Complete {n} contracts', stat: 'contracts', n: [2, 3, 5], reward: [200, 300, 500] },
  { id: 'deadeye', text: 'Get {n} kills in Dead-Eye', stat: 'deadeyeKills', n: [3, 6, 10], reward: [200, 320, 460] },
  { id: 'bulletcam', text: 'Trigger {n} Bullet Cams', stat: 'bulletcams', n: [3, 5, 8], reward: [180, 280, 400] },
  { id: 'stars', text: 'Earn {n} stars', stat: 'starsEarned', n: [3, 6, 9], reward: [220, 360, 520] },
  { id: 'nodmg', text: 'Finish {n} contracts unharmed', stat: 'flawless', n: [1, 2, 3], reward: [260, 400, 560] },
];

export const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood', desc: 'Take down your first outlaw.', reward: 100, test: (s) => s.kills >= 1 },
  { id: 'hs10', name: 'Marksman', desc: 'Land 10 headshots.', reward: 200, test: (s) => s.headshots >= 10 },
  { id: 'hs100', name: 'Dead Shot', desc: 'Land 100 headshots.', reward: 1000, test: (s) => s.headshots >= 100 },
  { id: 'kills50', name: 'Peacekeeper', desc: 'Take down 50 outlaws.', reward: 400, test: (s) => s.kills >= 50 },
  { id: 'kills250', name: 'Scourge of the West', desc: 'Take down 250 outlaws.', reward: 1500, test: (s) => s.kills >= 250 },
  { id: 'long200', name: 'Long Arm of the Law', desc: 'Hit a target 200m away.', reward: 300, test: (s) => s.longest >= 200 },
  { id: 'long300', name: 'Mile-High Shot', desc: 'Hit a target 300m away.', reward: 800, test: (s) => s.longest >= 300 },
  { id: 'collateral', name: 'Two for One', desc: 'Kill two outlaws with one bullet.', reward: 500, test: (s) => s.collaterals >= 1 },
  { id: 'boom', name: 'Powder Keg', desc: 'Kill an outlaw with an exploding barrel.', reward: 250, test: (s) => s.explosionKills >= 1 },
  { id: 'rider', name: 'Out of the Saddle', desc: 'Take down 10 riders.', reward: 400, test: (s) => s.riderKills >= 10 },
  { id: 'flawless', name: 'Untouchable', desc: 'Finish a contract without taking damage.', reward: 300, test: (s) => s.flawless >= 1 },
  { id: 'boss3', name: 'Wanted: Delivered', desc: 'Bring down all three Wanted bosses.', reward: 2000, test: (s) => s.bossesKilled >= 3 },
  { id: 'stars15', name: 'Rising Star', desc: 'Earn 15 stars.', reward: 500, test: (s, p) => p.totalStars() >= 15 },
  { id: 'stars45', name: 'Living Legend', desc: 'Earn all 45 stars.', reward: 5000, test: (s, p) => p.totalStars() >= 45 },
  { id: 'wave10', name: 'Last Man Standing', desc: 'Reach wave 10 in Showdown.', reward: 1000, test: (s) => s.bestWave >= 10 },
  { id: 'rich', name: 'Gold Rush', desc: 'Earn $20,000 in total.', reward: 1000, test: (s) => s.totalEarned >= 20000 },
  { id: 'deadeye25', name: 'Eye of the Hawk', desc: 'Get 25 kills in Dead-Eye.', reward: 600, test: (s) => s.deadeyeKills >= 25 },
];

export const TIPS = [
  'Hold SPACE to steady your breath before taking a long shot.',
  'Headshots pay 50% more bounty — and fill your Dead-Eye meter faster.',
  'A red ring over an outlaw means he is about to fire. Drop him first!',
  'Press F to unleash Dead-Eye: time slows and your aim is rock steady.',
  'Bullets drop and drift over distance. Use the mil-dots under the crosshair.',
  'Shoot the red powder barrels to take out whole groups at once.',
  'Moving riders need a lead — aim a little ahead of the horse.',
  'Check the Bounty Board every day for fresh challenges and rewards.',
  'Hitting a civilian costs you money and can fail the contract.',
  'Upgrade Steady Hands at the Gunsmith to tame scope sway.',
];

// ------------------------------------------------------------------ profile
const DEFAULT_SETTINGS = {
  master: 0.8, music: 0.55, sfx: 0.9, sensitivity: 1.0, scopeSensitivity: 0.75, invertY: false,
  quality: 'high', fov: 60, holdToScope: true, showFps: false, bulletCam: true, screenShake: true, hints: true,
};

function defaultProfile() {
  return {
    version: 1, cash: 300, xp: 0,
    rifles: ['carbine'], equipped: 'carbine',
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    stars: {}, best: {}, completed: {},
    achievements: {},
    stats: { kills: 0, headshots: 0, shots: 0, hits: 0, longest: 0, collaterals: 0, explosionKills: 0, riderKills: 0, flawless: 0, bossesKilled: 0, bestWave: 0, bestShowdown: 0, totalEarned: 0, deadeyeKills: 0, bulletcams: 0, contracts: 0, longshots: 0, starsEarned: 0, playSeconds: 0 },
    daily: { lastClaim: null, streak: 0 },
    challenges: { date: null, list: [] },
    settings: { ...DEFAULT_SETTINGS },
    seenTutorial: false,
  };
}

export class Profile {
  constructor(events) {
    this.events = events;
    const saved = Storage.get(SAVE_KEY);
    const base = defaultProfile();
    this.data = saved ? { ...base, ...saved, stats: { ...base.stats, ...(saved.stats || {}) }, settings: { ...base.settings, ...(saved.settings || {}) }, upgrades: { ...base.upgrades, ...(saved.upgrades || {}) } } : base;
    this.refreshChallenges();
  }
  save() { Storage.set(SAVE_KEY, this.data); }
  reset() { this.data = defaultProfile(); this.refreshChallenges(); this.save(); }

  get settings() { return this.data.settings; }
  get cash() { return this.data.cash; }

  addCash(amount, countEarned = true) {
    this.data.cash = Math.max(0, Math.round(this.data.cash + amount));
    if (amount > 0 && countEarned) this.data.stats.totalEarned += amount;
    this.events?.emit('cash', this.data.cash);
  }
  spend(amount) {
    if (this.data.cash < amount) return false;
    this.data.cash -= amount;
    this.events?.emit('cash', this.data.cash);
    this.save();
    return true;
  }
  addXp(xp) {
    const before = this.rank().index;
    this.data.xp += Math.round(xp);
    const after = this.rank().index;
    return after > before ? RANKS[after] : null;
  }
  rank() {
    let index = 0;
    RANKS.forEach((r, i) => { if (this.data.xp >= r.xp) index = i; });
    const next = RANKS[index + 1];
    const cur = RANKS[index];
    return { index, name: cur.name, progress: next ? (this.data.xp - cur.xp) / (next.xp - cur.xp) : 1, next };
  }

  // -- weapons & upgrades
  rifle() { return RIFLES.find((r) => r.id === this.data.equipped) || RIFLES[0]; }
  ownsRifle(id) { return this.data.rifles.includes(id); }
  buyRifle(id) {
    const r = RIFLES.find((x) => x.id === id);
    if (!r || this.ownsRifle(id) || !this.spend(r.price)) return false;
    this.data.rifles.push(id); this.data.equipped = id; this.save();
    return true;
  }
  equip(id) { if (this.ownsRifle(id)) { this.data.equipped = id; this.save(); } }
  upgradeLevel(id) { return this.data.upgrades[id] || 0; }
  upgradeCost(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const lvl = this.upgradeLevel(id);
    return lvl >= u.costs.length ? null : u.costs[lvl];
  }
  buyUpgrade(id) {
    const cost = this.upgradeCost(id);
    if (cost == null || !this.spend(cost)) return false;
    this.data.upgrades[id] += 1; this.save();
    return true;
  }
  upgradeValue(id) {
    const u = UPGRADES.find((x) => x.id === id);
    return u.per * this.upgradeLevel(id);
  }

  // -- contracts
  contractStars(id) { return this.data.stars[id] || 0; }
  totalStars() { return Object.values(this.data.stars).reduce((a, b) => a + b, 0); }
  territoryUnlocked(i) { return this.totalStars() >= TERRITORIES[i].starsRequired; }
  contractUnlocked(c) {
    if (!this.territoryUnlocked(c.territory)) return false;
    const idx = CONTRACTS.indexOf(c);
    if (idx === 0) return true;
    const prev = CONTRACTS[idx - 1];
    // The first contract of a territory opens with the star requirement; the rest chain.
    return prev.territory !== c.territory || !!this.data.completed[prev.id];
  }
  nextContract() {
    return CONTRACTS.find((c) => this.contractUnlocked(c) && !this.data.completed[c.id]) || CONTRACTS.filter((c) => this.contractUnlocked(c)).pop();
  }
  showdownUnlocked() { return !!this.data.completed[SHOWDOWN.unlockAfter]; }
  recordContract(id, stars) {
    const prev = this.contractStars(id);
    const gained = Math.max(0, stars - prev);
    this.data.stars[id] = Math.max(prev, stars);
    this.data.completed[id] = true;
    this.data.stats.contracts += 1;
    this.data.stats.starsEarned += gained;
    this.bumpChallenge('contracts', 1);
    this.bumpChallenge('starsEarned', gained);
    return gained;
  }

  // -- stats, challenges & achievements
  stat(key, amount = 1) {
    this.data.stats[key] = (this.data.stats[key] || 0) + amount;
    this.bumpChallenge(key, amount);
  }
  statMax(key, value) { this.data.stats[key] = Math.max(this.data.stats[key] || 0, value); }

  refreshChallenges() {
    const today = dateKey();
    if (this.data.challenges.date === today && this.data.challenges.list.length) return;
    const rnd = seededRandom(hashString(today));
    const pool = CHALLENGE_POOL.slice();
    const list = [];
    for (let i = 0; i < 3; i++) {
      const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const tier = Math.min(2, Math.floor(rnd() * 3));
      const text = c.text.replace('{n}', c.n[tier]).replace(c.n[tier] === 1 ? /contracts/ : /$^/, 'contract');
      list.push({ id: c.id, text, stat: c.stat, target: c.n[tier], reward: c.reward[tier], progress: 0, claimed: false });
    }
    this.data.challenges = { date: today, list };
    this.save();
  }
  bumpChallenge(stat, amount) {
    if (!amount) return;
    for (const c of this.data.challenges.list) {
      if (c.stat === stat && !c.claimed) {
        const was = c.progress;
        c.progress = Math.min(c.target, c.progress + amount);
        if (was < c.target && c.progress >= c.target) this.events?.emit('challengeDone', c);
      }
    }
  }
  claimChallenge(i) {
    const c = this.data.challenges.list[i];
    if (!c || c.claimed || c.progress < c.target) return 0;
    c.claimed = true;
    this.addCash(c.reward);
    this.save();
    return c.reward;
  }
  checkAchievements() {
    const unlocked = [];
    for (const a of ACHIEVEMENTS) {
      if (!this.data.achievements[a.id] && a.test(this.data.stats, this)) {
        this.data.achievements[a.id] = Date.now();
        this.addCash(a.reward);
        unlocked.push(a);
      }
    }
    if (unlocked.length) this.save();
    return unlocked;
  }

  // -- daily login reward
  dailyStatus() {
    const today = dateKey();
    const last = this.data.daily.lastClaim;
    if (last === today) return { available: false, day: this.data.daily.streak };
    const gap = last ? daysBetween(last, today) : 99;
    const streak = gap === 1 ? this.data.daily.streak : 0;
    const day = (streak % DAILY_REWARDS.length) + 1;
    return { available: true, day, amount: DAILY_REWARDS[day - 1] };
  }
  claimDaily() {
    const st = this.dailyStatus();
    if (!st.available) return 0;
    this.data.daily = { lastClaim: dateKey(), streak: st.day };
    this.addCash(st.amount);
    this.save();
    return st.amount;
  }

  accuracy() {
    const s = this.data.stats;
    return s.shots ? clamp(s.hits / s.shots, 0, 1) : 0;
  }
}
