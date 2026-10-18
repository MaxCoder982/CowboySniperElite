# Cowboy Sniper Elite

A Wild West **3D sniper game** for the browser: HTML5, WebGL ([three.js](https://threejs.org)) and Web Audio, with no build step.

Climb the lookout tower, scope the street and clean up the frontier one bounty at a time. There are 15 contracts across three territories, five objective types, Wanted bosses, an endless Showdown mode, a gunsmith with three rifles and six upgrade tracks, daily rewards, daily challenges, achievements and ranks.

## Run it

The game uses ES modules and WebGL textures, so it must be served over HTTP. Opening `index.html` from the file system will not work.

```bash
# any static server works, e.g.
npx serve .            # or: python3 -m http.server 8080
# then open http://localhost:3000 (or :8080)
```

Click **Click to Ride**. The game switches to full screen; you can also toggle it with the button in the top bar or F11. Click the view to lock the mouse and take aim.

## Controls

| Input | Action |
|---|---|
| Mouse | Aim (pointer-lock) |
| Left click | Fire |
| Right click / Shift | Scope in (hold, or toggle in Settings) |
| Mouse wheel / Q, E | Change scope zoom |
| Space (hold) | Hold breath — steadies the scope |
| R | Reload |
| F | Dead-Eye slow motion (when the meter is ≥ 30%) |
| W A S D / Arrows | Fine aim; also menu navigation |
| Tab | Show the current objective |
| Esc / P | Pause, or back in menus |
| Enter | Confirm / start |
| M | Mute |

## Gameplay

- **Ballistics:** bullets travel in real time, drop over distance and drift with the wind. The scope reticle has 100/200/300 m drop ticks and wind-hold dots, plus a live rangefinder.
- **Sway & breath:** the scope drifts. Hold your breath to steady it, but hold it too long and you'll gasp.
- **Threats shoot back:** an outlaw drawing on you shows a red ring that fills up. Shoot first, or take damage. Off-screen threats show edge arrows.
- **Objectives:** Elimination, Stop the Getaway (runners and riders), Hostage Rescue (each taker has a fuse; don't hit the captives), Train Ambush (lead the moving train) and Wanted Boss (thin the gang, then the boss appears and relocates when wounded).
- **Bounties:** each kill pays a bounty. Headshots, long shots (150 m+), collaterals, Dead-Eye kills, explosions and kill streaks pay extra. Headshot kills also refund a round. Civilian hits are docked.
- **Bullet cam:** the finishing shot, long headshots and boss kills trigger a slow-motion chase cam that follows the bullet.
- **Explosive barrels:** red powder barrels blow up and chain-react.
- **Stars:** each contract has 3 stars (complete it; hit the accuracy target; land the required headshots). Stars unlock the next territory.
- **Progression:** cash buys rifles (Peacemaker Carbine, Longhorn .45-70, Elite Sharps "Widowmaker" with piercing rounds) and upgrades (Steady Hands, Iron Lungs, Quick Hands, Leather Duster, Bandolier, Dead-Eye). XP raises your rank from Greenhorn to *Legend of the West*.
- **Retention:** a 7-day login streak, three daily challenges, 17 achievements, the endless Showdown with a best-wave record, and an auto-saved profile (localStorage).

### Territories

| Territory | Time of day | Setting |
|---|---|---|
| Dustwater Gulch | High Noon | Main Street boomtown, church on the terrace, canyon buttes |
| Red Mesa Junction | Sundown | Railway depot, passing express train, water tower, crosswinds |
| Coyote Ridge | Midnight | Lantern-lit street, gallows, mine entrance, starfield |

## Project structure

```
index.html              screens + HUD markup
css/                    fonts.css · main.css · menus.css · hud.css
js/                     10 ES modules
  core.js               math, RNG/noise, storage, events, input, hit-test geometry
  data.js               rifles, upgrades, territories, contracts, achievements + Profile (save/economy)
  audio.js              Web Audio engine (SFX, music crossfades, slow-mo pitch, muffling)
  assets.js             texture/JSON loading, PBR material library, JSON→mesh builder, batching
  world.js              sky shader, IBL, lighting presets, terrain, procedural architecture,
                        3 layouts, props, ambient life, train, FX particles
  actors.js             skeletal cowboy/lady/horse rigs, pose blending, hitboxes, deaths, AI behaviours
  mission.js            mission director: spawning, objectives, bounties, stars, Showdown, tutorial
  combat.js             aim, scope, sway, breath, ballistics, explosions, Dead-Eye, bullet cam, view-model
  ui.js                 menus, navigation, HUD, kill feed, canvas scope overlay
  main.js               bootstrap, renderer, state machine, main loop, settlement
assets/
  3d/                   materials.json · props.json · rifles.json · characters.json (model definitions)
  images/textures/      terrain, wood, adobe, brick, tin, rock, signs, particles, mesa skylines, clouds
  images/ui/            logo, buttons, leather, parchment, wanted poster, vignette, grain, scope dirt
  images/icons/         SVG icon set + coin / bullet / sheriff-star bitmaps
  images/backgrounds/   menu_bg.jpg (rendered from the game world)
  audio/sfx, audio/music  31 sound effects + 2 music loops (MP3)
  fonts/                Rye, Teko, Smokum (SIL OFL)
  vendor/               three.module.min.js (r170, MIT)
tools/                  gen_textures.py · gen_audio.py — regenerate every bitmap and sound
```

## Asset pipeline

Every texture, UI bitmap, sound effect and music track is generated by the scripts in `tools/` with NumPy, Pillow and ffmpeg. The 3D models are data-driven JSON part lists in `assets/3d/`, built into meshes at runtime. To regenerate the assets:

```bash
python3 tools/gen_textures.py   # needs numpy + Pillow
python3 tools/gen_audio.py      # needs numpy + ffmpeg
```

## Credits & licences

- three.js © three.js authors, MIT (`assets/vendor/three.LICENSE`)
- Rye, Teko and Smokum fonts, SIL Open Font License (`assets/fonts/LICENSE-*.txt`)
- All other art, audio, models and code are original to this project.
