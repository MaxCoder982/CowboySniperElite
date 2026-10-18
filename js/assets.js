// assets.js — loads textures + JSON model definitions and builds Three.js meshes from them.
import * as THREE from 'three';

const TEXTURES = [
  'sand.jpg', 'wood_planks.jpg', 'adobe.jpg', 'brick.jpg', 'tin_roof.jpg', 'rock.jpg', 'cloth.jpg',
  'street_tracks.png', 'window_lit.jpg', 'window_dark.jpg', 'smoke.png', 'dust.png', 'muzzle_flash.png',
  'glint.png', 'spark.png', 'hit_mist.png', 'tumbleweed.png', 'mesa_layer0.png', 'mesa_layer1.png', 'clouds.png',
  'sign_saloon.jpg', 'sign_bank.jpg', 'sign_sheriff.jpg', 'sign_hotel.jpg', 'sign_store.jpg', 'sign_undertaker.jpg',
  'sign_blacksmith.jpg', 'sign_station.jpg', 'sign_assay.jpg', 'sign_telegraph.jpg', 'sign_barber.jpg', 'sign_livery.jpg',
];
const DATA_TEXTURES = new Set(['smoke.png', 'dust.png', 'muzzle_flash.png', 'glint.png', 'spark.png', 'hit_mist.png']);
const JSON_FILES = ['materials', 'props', 'rifles', 'characters'];

export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.textures = new Map();
    this.json = {};
    this.materials = new Map();
    this.geoCache = new Map();
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  async load(onProgress) {
    const loader = new THREE.TextureLoader();
    const total = TEXTURES.length + JSON_FILES.length;
    let done = 0;
    const tick = () => { done++; onProgress && onProgress(done / total); };
    const texPromises = TEXTURES.map((file) => new Promise((resolve) => {
      loader.load(`assets/images/textures/${file}`, (tex) => {
        if (!DATA_TEXTURES.has(file)) tex.colorSpace = THREE.SRGBColorSpace;
        else tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = Math.min(8, this.maxAniso);
        this.textures.set(file.replace(/\.(jpg|png)$/, ''), tex);
        tick(); resolve();
      }, undefined, () => { console.warn('texture failed', file); tick(); resolve(); });
    }));
    const jsonPromises = JSON_FILES.map(async (name) => {
      const res = await fetch(`assets/3d/${name}.json`);
      this.json[name] = await res.json();
      tick();
    });
    await Promise.all([...texPromises, ...jsonPromises]);
    this.buildMaterials();
  }

  tex(name) { return this.textures.get(name.replace(/\.(jpg|png)$/, '')) || null; }

  // Texture copy with its own tiling (shares the uploaded image).
  texRepeat(name, rx, ry) {
    const base = this.tex(name);
    if (!base) return null;
    const key = `${name}@${rx}x${ry}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const t = base.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    this.textures.set(key, t);
    return t;
  }

  buildMaterials() {
    const defs = this.json.materials.materials;
    for (const [name, d] of Object.entries(defs)) {
      const params = {
        color: new THREE.Color(d.color || '#ffffff'),
        roughness: d.roughness ?? 0.9,
        metalness: d.metalness ?? 0,
      };
      if (d.map) {
        const rep = d.repeat || [1, 1];
        params.map = this.texRepeat(d.map, rep[0], rep[1]);
        if (d.bump) { params.bumpMap = params.map; params.bumpScale = d.bump * 20; }
      }
      if (d.emissive) {
        params.emissive = new THREE.Color(d.emissive);
        params.emissiveIntensity = d.emissiveIntensity ?? 1;
      }
      const m = new THREE.MeshStandardMaterial(params);
      m.userData.shared = true;
      this.materials.set(name, m);
    }
  }

  mat(name) { return this.materials.get(name) || this.materials.get('wood'); }

  // Standard material with world-scale tiling (tile = metres per texture repeat).
  surface(texName, tile, color = '#ffffff', opts = {}) {
    const key = `surf:${texName}:${color}:${JSON.stringify(opts)}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const map = this.tex(texName);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), map, roughness: opts.roughness ?? 0.92, metalness: opts.metalness ?? 0,
      bumpMap: opts.bump ? map : null, bumpScale: opts.bump ?? 0,
    });
    m.userData.tile = tile;
    m.userData.shared = true;
    this.materials.set(key, m);
    return m;
  }

  // Box geometry whose UVs are in metres / tile, so textures keep a constant scale on any size.
  boxGeo(w, h, d, tile = 2) {
    const key = `box:${w}:${h}:${d}:${tile}`;
    if (this.geoCache.has(key)) return this.geoCache.get(key);
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let face = 0; face < 6; face++) {
      for (let i = 0; i < 4; i++) {
        const idx = face * 4 + i;
        uv.setXY(idx, uv.getX(idx) * dims[face][0] / tile, uv.getY(idx) * dims[face][1] / tile);
      }
    }
    uv.needsUpdate = true;
    g.userData.cached = true;
    this.geoCache.set(key, g);
    return g;
  }

  geometry(part) {
    const key = part.g + ':' + JSON.stringify(part.a || part.pts) + ':' + (part.seg || '') + ':' + (part.jitter || '');
    if (this.geoCache.has(key)) return this.geoCache.get(key);
    const a = part.a || [];
    let g;
    switch (part.g) {
      case 'box': g = new THREE.BoxGeometry(...a); break;
      case 'cyl': g = new THREE.CylinderGeometry(...a); break;
      case 'sphere': g = new THREE.SphereGeometry(...a); break;
      case 'cone': g = new THREE.ConeGeometry(...a); break;
      case 'torus': g = new THREE.TorusGeometry(...a); break;
      case 'capsule': g = new THREE.CapsuleGeometry(...a); break;
      case 'dodeca': g = new THREE.DodecahedronGeometry(...a); break;
      case 'lathe': g = new THREE.LatheGeometry(part.pts.map(([x, y]) => new THREE.Vector2(x, y)), part.seg || 16); break;
      default: g = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    }
    if (part.jitter) jitterGeometry(g, part.jitter);
    g.userData.cached = true;
    this.geoCache.set(key, g);
    return g;
  }

  /** Build a model from a JSON library ('props' | 'rifles'). Returns a Group with userData.parts (named nodes). */
  build(name, lib = 'props', opts = {}) {
    const def = this.json[lib]?.models?.[name];
    const root = new THREE.Group();
    root.name = name;
    root.userData.parts = {};
    root.userData.def = def;
    if (!def) { console.warn('missing model', name); return root; }
    const addParts = (parts, parent) => {
      for (const p of parts) {
        let node;
        if (p.ref) {
          node = this.build(p.ref, lib, opts);
          Object.assign(root.userData.parts, node.userData.parts);
        } else if (p.children) {
          node = new THREE.Group();
          addParts(p.children, node);
        } else {
          const mat = opts.material || this.mat(p.m);
          node = new THREE.Mesh(this.geometry(p), p.double ? doubleSided(mat, this) : mat);
          node.castShadow = opts.castShadow ?? true;
          node.receiveShadow = opts.receiveShadow ?? true;
        }
        if (p.p) node.position.set(...p.p);
        if (p.r) node.rotation.set(p.r[0] * Math.PI / 180, p.r[1] * Math.PI / 180, p.r[2] * Math.PI / 180);
        if (p.s) node.scale.set(...p.s);
        if (p.name) { node.name = p.name; root.userData.parts[p.name] = node; }
        parent.add(node);
      }
    };
    addParts(def.parts, root);
    return root;
  }
}

function doubleSided(mat, assets) {
  const key = mat.uuid + ':double';
  if (assets.materials.has(key)) return assets.materials.get(key);
  const m = mat.clone();
  m.side = THREE.DoubleSide;
  m.userData.shared = true;
  assets.materials.set(key, m);
  return m;
}

/** Merge meshes (same material) into one world-space, non-indexed geometry for batched rendering. */
export function mergeMeshes(list) {
  const parts = [];
  let count = 0;
  for (const m of list) {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    parts.push(g);
    count += g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), o * 2);
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// Deterministic per-position displacement so shared vertices stay welded.
function jitterGeometry(g, amount) {
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    const n = (h - Math.floor(h)) * 2 - 1;
    v.multiplyScalar(1 + n * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}
