#!/usr/bin/env python3
"""Procedural texture + 2D art generator for Cowboy Sniper Elite.

Writes every bitmap the game uses into assets/images/. Run from the repo root:
    python3 tools/gen_textures.py
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "assets", "images")
FONT_RYE = os.path.join(ROOT, "tools", "fonts", "Rye-Regular.woff")
FONT_TEKO = os.path.join(ROOT, "tools", "fonts", "Teko-SemiBold.woff")

rng = np.random.default_rng(1873)
random.seed(1873)


def out(sub, name):
    d = os.path.join(IMG, sub)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


# ---------------------------------------------------------------- noise utils
def tile_noise(size, cells, seed=None):
    """Tileable value noise in [0,1] with smooth interpolation."""
    r = np.random.default_rng(seed) if seed is not None else rng
    grid = r.random((cells, cells))
    t = np.linspace(0, cells, size, endpoint=False)
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    i0 = i0 % cells
    fy = f[:, None]
    fx = f[None, :]
    a = grid[i0][:, i0]
    b = grid[i0][:, i1]
    c = grid[i1][:, i0]
    d = grid[i1][:, i1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(size, base=4, octaves=5, seed=0, gain=0.5):
    total = np.zeros((size, size))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        cells = base * (2 ** o)
        if cells > size:
            break
        total += amp * tile_noise(size, cells, seed + o * 31)
        norm += amp
        amp *= gain
    return total / norm


def stretch_noise(w, h, cx, cy, seed):
    """Anisotropic tileable noise (for wood grain)."""
    r = np.random.default_rng(seed)
    grid = r.random((cy, cx))
    ty = np.linspace(0, cy, h, endpoint=False)
    tx = np.linspace(0, cx, w, endpoint=False)
    y0 = np.floor(ty).astype(int)
    x0 = np.floor(tx).astype(int)
    fy = ty - y0
    fx = tx - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    y1 = (y0 + 1) % cy
    x1 = (x0 + 1) % cx
    a = grid[y0][:, x0]
    b = grid[y0][:, x1]
    c = grid[y1][:, x0]
    d = grid[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def colorize(v, stops):
    """Map scalar field v in [0,1] through a list of (pos, (r,g,b))."""
    v = np.clip(v, 0, 1)
    out_img = np.zeros(v.shape + (3,))
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        m = (v >= p0) & (v <= p1)
        t = ((v - p0) / max(p1 - p0, 1e-6))[m][:, None]
        out_img[m] = np.array(c0) * (1 - t) + np.array(c1) * t
    return out_img


def save_rgb(arr, path, quality=None):
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    if path.endswith(".jpg"):
        img.save(path, quality=quality or 88, optimize=True)
    else:
        img.save(path, optimize=True)


# ---------------------------------------------------------------- textures
def tex_sand():
    s = 512
    n = fbm(s, 4, 6, seed=10)
    fine = fbm(s, 64, 3, seed=20)
    ripples = np.sin((np.arange(s)[:, None] * 0.09 + n * 9.0)) * 0.5 + 0.5
    v = n * 0.65 + fine * 0.25 + ripples * 0.1
    col = colorize(v, [(0, (150, 110, 70)), (0.45, (196, 152, 98)), (0.7, (222, 182, 126)), (1, (238, 206, 152))])
    # pebbles
    img = Image.fromarray(col.astype(np.uint8))
    d = ImageDraw.Draw(img)
    for _ in range(420):
        x, y = random.randrange(s), random.randrange(s)
        r = random.choice([1, 1, 1, 2, 2, 3])
        g = random.randint(90, 170)
        for ox in (-s, 0, s):
            for oy in (-s, 0, s):
                d.ellipse([x - r + ox, y - r + oy, x + r + ox, y + r + oy], fill=(g + 10, g - 5, g - 30))
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(out("textures", "sand.jpg"), quality=88)


def tex_wood():
    w = h = 512
    planks = 6
    pw = w // planks
    grain = stretch_noise(w, h, 64, 6, 3)
    grain2 = stretch_noise(w, h, 160, 12, 4)
    big = fbm(512, 4, 4, seed=5)
    img = np.zeros((h, w, 3))
    for p in range(planks):
        x0, x1 = p * pw, (p + 1) * pw
        shade = 0.75 + 0.35 * random.random()
        g = grain[:, x0:x1] * 0.6 + grain2[:, x0:x1] * 0.4
        rings = np.sin(g * 40 + np.linspace(0, 3, x1 - x0)[None, :]) * 0.5 + 0.5
        v = (g * 0.6 + rings * 0.25 + big[:, x0:x1] * 0.15) * shade
        img[:, x0:x1] = colorize(v, [(0, (60, 40, 26)), (0.4, (112, 80, 52)), (0.7, (150, 112, 74)), (1, (188, 150, 104))])
        img[:, x0:x0 + 3] *= 0.35  # gap
        img[:, x1 - 2:x1] *= 0.6
        # horizontal butt joint
        jy = random.randrange(h)
        img[jy:jy + 3, x0:x1] *= 0.4
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)
    for p in range(planks):
        for yy in (24, h - 30):
            cx = p * pw + pw // 2
            d.ellipse([cx - 3, yy - 3, cx + 3, yy + 3], fill=(40, 30, 24))
            d.ellipse([cx - 1, yy - 2, cx + 1, yy], fill=(120, 110, 100))
    pil.save(out("textures", "wood_planks.jpg"), quality=88)


def tex_adobe():
    s = 512
    n = fbm(s, 3, 6, seed=40)
    f = fbm(s, 48, 3, seed=41)
    v = n * 0.7 + f * 0.3
    col = colorize(v, [(0, (150, 96, 64)), (0.5, (196, 140, 96)), (1, (226, 186, 140))])
    pil = Image.fromarray(col.astype(np.uint8))
    d = ImageDraw.Draw(pil)
    for _ in range(14):  # cracks
        x, y = random.randrange(s), random.randrange(s)
        for _ in range(random.randint(8, 24)):
            nx = x + random.randint(-14, 14)
            ny = y + random.randint(2, 16)
            d.line([x, y, nx, ny], fill=(110, 70, 48), width=1)
            x, y = nx, ny
    pil = pil.filter(ImageFilter.GaussianBlur(0.5))
    pil.save(out("textures", "adobe.jpg"), quality=88)


def tex_brick():
    s = 512
    rows, cols = 16, 6
    bh, bw = s // rows, s // cols
    base = fbm(s, 8, 4, seed=50)
    img = np.zeros((s, s, 3))
    img[:] = np.array([170, 150, 128])[None, None, :] * (0.8 + base[..., None] * 0.3)
    for r in range(rows):
        off = (bw // 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0 = c * bw + off + 3
            y0 = r * bh + 3
            x1, y1 = x0 + bw - 5, y0 + bh - 5
            tone = np.array([150 + random.randint(-25, 25), 70 + random.randint(-15, 20), 50 + random.randint(-10, 15)])
            xs0, xs1 = max(x0, 0), min(x1, s)
            if xs1 <= xs0:
                continue
            img[y0:y1, xs0:xs1] = tone[None, None, :] * (0.8 + base[y0:y1, xs0:xs1, None] * 0.45)
    save_rgb(img, out("textures", "brick.jpg"))


def tex_tin():
    s = 512
    x = np.arange(s)[None, :].repeat(s, 0)
    corr = np.sin(x / s * math.pi * 2 * 16) * 0.5 + 0.5
    rust = fbm(s, 4, 6, seed=60)
    streak = stretch_noise(s, s, 48, 3, 61)
    v = corr * 0.45 + 0.35
    metal = colorize(v, [(0, (90, 94, 98)), (1, (176, 180, 184))])
    rustc = colorize(rust, [(0, (90, 40, 20)), (1, (170, 92, 44))])
    m = np.clip((rust * 0.7 + streak * 0.5) - 0.45, 0, 1)[..., None] * 2.2
    m = np.clip(m, 0, 1)
    img = metal * (1 - m) + rustc * m
    img *= (0.75 + corr[..., None] * 0.35)
    save_rgb(img, out("textures", "tin_roof.jpg"))


def tex_rock():
    s = 512
    n = fbm(s, 4, 6, seed=70)
    y = np.arange(s)[:, None].repeat(s, 1)
    strata = np.sin(y / s * math.pi * 2 * 9 + n * 6) * 0.5 + 0.5
    v = strata * 0.45 + n * 0.55
    col = colorize(v, [(0, (110, 54, 34)), (0.35, (160, 82, 48)), (0.6, (196, 118, 70)), (0.85, (214, 150, 98)), (1, (230, 186, 140))])
    save_rgb(col, out("textures", "rock.jpg"))


def tex_cloth():
    s = 128
    n = fbm(s, 8, 4, seed=80)
    x = np.arange(s)
    weave = (np.sin(x[None, :] * 1.6) * np.sin(x[:, None] * 1.6)) * 0.5 + 0.5
    v = 0.7 + n * 0.2 + weave * 0.1
    img = np.stack([v, v, v], -1) * 255
    save_rgb(img, out("textures", "cloth.jpg"))


def tex_leather():
    s = 256
    n = fbm(s, 6, 6, seed=90)
    cells = fbm(s, 32, 2, seed=91)
    v = n * 0.6 + cells * 0.4
    col = colorize(v, [(0, (40, 22, 14)), (0.5, (78, 44, 24)), (1, (112, 66, 36))])
    save_rgb(col, out("ui", "leather.jpg"))


def tex_parchment():
    s = 512
    n = fbm(s, 3, 6, seed=100)
    f = fbm(s, 32, 3, seed=101)
    v = n * 0.75 + f * 0.25
    col = colorize(v, [(0, (196, 160, 110)), (0.5, (226, 198, 150)), (1, (244, 226, 186))])
    save_rgb(col, out("ui", "parchment.jpg"))


def tex_ground_detail():
    """Dark tire/hoof tracks + grass tufts used as decals on the street."""
    s = 512
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for lane in (s * 0.35, s * 0.65):
        for y in range(0, s, 3):
            x = lane + math.sin(y * 0.02) * 6 + random.uniform(-1.5, 1.5)
            d.ellipse([x - 9, y - 2, x + 9, y + 2], fill=(90, 60, 36, 50))
    for _ in range(140):  # hoof prints
        x, y = random.uniform(s * 0.4, s * 0.6), random.uniform(0, s)
        d.ellipse([x - 4, y - 3, x + 4, y + 3], fill=(80, 54, 34, 70))
    img = img.filter(ImageFilter.GaussianBlur(1.5))
    img.save(out("textures", "street_tracks.png"), optimize=True)


# ---------------------------------------------------------------- sprites
def radial(s, inner=0.0, power=2.0):
    y, x = np.mgrid[0:s, 0:s]
    c = (s - 1) / 2
    r = np.sqrt((x - c) ** 2 + (y - c) ** 2) / c
    a = np.clip(1 - (r - inner) / (1 - inner), 0, 1) ** power
    return a


def sprite_smoke():
    s = 128
    a = radial(s, 0.0, 1.6)
    n = fbm(s, 4, 5, seed=110)
    a = np.clip(a * (0.55 + n * 0.8), 0, 1)
    rgba = np.zeros((s, s, 4))
    rgba[..., :3] = 235
    rgba[..., 3] = a * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "smoke.png"))


def sprite_dust():
    s = 128
    a = radial(s, 0.0, 1.3)
    n = fbm(s, 4, 5, seed=111)
    a = np.clip(a * (0.4 + n), 0, 1) * 0.9
    rgba = np.zeros((s, s, 4))
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 214, 176, 128
    rgba[..., 3] = a * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "dust.png"))


def sprite_flash():
    s = 256
    y, x = np.mgrid[0:s, 0:s]
    c = (s - 1) / 2
    dx, dy = (x - c) / c, (y - c) / c
    r = np.sqrt(dx * dx + dy * dy)
    ang = np.arctan2(dy, dx)
    spikes = (np.abs(np.cos(ang * 4)) ** 8) * 0.6 + (np.abs(np.cos(ang * 4 + 0.4)) ** 20) * 0.4
    core = np.clip(1 - r * 3.0, 0, 1) ** 1.2
    rays = np.clip(1 - r / (0.25 + spikes * 0.75), 0, 1) ** 2
    a = np.clip(core + rays * 0.9, 0, 1)
    rgba = np.zeros((s, s, 4))
    rgba[..., 0] = 255
    rgba[..., 1] = 200 + 55 * core
    rgba[..., 2] = 90 + 165 * core
    rgba[..., 3] = a * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "muzzle_flash.png"))


def sprite_glint():
    s = 256
    y, x = np.mgrid[0:s, 0:s]
    c = (s - 1) / 2
    dx, dy = np.abs(x - c) / c, np.abs(y - c) / c
    r = np.sqrt(dx * dx + dy * dy)
    streak = np.clip(1 - dx, 0, 1) ** 6 * np.clip(1 - dy * 22, 0, 1) + np.clip(1 - dy, 0, 1) ** 6 * np.clip(1 - dx * 22, 0, 1)
    core = np.clip(1 - r * 2.5, 0, 1) ** 2
    a = np.clip(streak * 0.9 + core, 0, 1)
    rgba = np.zeros((s, s, 4))
    rgba[..., :3] = 255
    rgba[..., 3] = a * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "glint.png"))


def sprite_spark():
    s = 64
    a = radial(s, 0.0, 3)
    rgba = np.zeros((s, s, 4))
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 255, 230, 160
    rgba[..., 3] = a * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "spark.png"))


def sprite_blood():
    s = 128
    a = radial(s, 0.0, 1.2)
    n = fbm(s, 8, 4, seed=120)
    a = np.clip((a * (0.3 + n * 1.2)) - 0.15, 0, 1) * 1.3
    rgba = np.zeros((s, s, 4))
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 150, 18, 16
    rgba[..., 3] = np.clip(a, 0, 1) * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "hit_mist.png"))


def sprite_tumbleweed():
    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = s / 2
    for _ in range(260):
        a0 = random.uniform(0, math.tau)
        r0 = random.uniform(0, s * 0.42)
        x0, y0 = c + math.cos(a0) * r0, c + math.sin(a0) * r0
        a1 = a0 + random.uniform(-1.4, 1.4)
        ln = random.uniform(20, 70)
        x1, y1 = x0 + math.cos(a1) * ln, y0 + math.sin(a1) * ln
        if math.hypot(x1 - c, y1 - c) > s * 0.47:
            continue
        tone = random.randint(100, 170)
        d.line([x0, y0, x1, y1], fill=(tone, int(tone * 0.78), int(tone * 0.5), 255), width=random.choice([1, 2, 2, 3]))
    img.save(out("textures", "tumbleweed.png"))


def sprite_mesa():
    """Distant mesa/butte skyline strips (2 depth layers), tileable horizontally."""
    w, h = 2048, 384
    xs = np.arange(w)
    for layer, seed in enumerate((130, 140)):
        r = np.random.default_rng(seed)
        heights = np.full(w, 0.12)
        # low rolling base
        for k in (1, 2, 3, 5):
            heights += r.uniform(0.01, 0.04) * np.sin(xs / w * math.tau * k + r.uniform(0, 6))
        count = 7 if layer == 0 else 9
        for _ in range(count):
            cx = r.uniform(0, w)
            half = r.uniform(60, 220) if layer == 0 else r.uniform(40, 160)
            top = r.uniform(0.45, 0.85) if layer == 0 else r.uniform(0.3, 0.6)
            slope = r.uniform(18, 40)
            dist = np.minimum(np.abs(xs - cx), w - np.abs(xs - cx))
            body = 1 / (1 + np.exp((dist - half) / slope * 4))
            # talus skirt at the base
            skirt = np.clip(1 - (dist - half) / (half * 0.9 + 60), 0, 1) ** 1.6 * 0.45
            heights = np.maximum(heights, top * np.maximum(body, skirt))
        n = np.cumsum(r.normal(0, 0.003, w))
        n -= np.linspace(n[0], n[-1], w)
        heights = np.clip(heights + n, 0.05, 0.97)
        ys = np.arange(h)[:, None]
        top_px = (1 - heights[None, :]) * h
        a = np.clip(ys - top_px + 0.5, 0, 1)
        strata = np.sin(ys / h * 70 + np.sin(xs[None, :] / 90) * 0.6) * 0.5 + 0.5
        light = np.clip(1 - (ys - top_px) / (h * 0.7), 0.6, 1)
        shade = (0.86 + 0.14 * strata) * light
        rgba = np.zeros((h, w, 4))
        rgba[..., :3] = 255 * shade[..., None]
        rgba[..., 3] = a * 255
        Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(out("textures", f"mesa_layer{layer}.png"))


def sprite_clouds():
    s = 512
    n = fbm(s, 3, 7, seed=150)
    a = np.clip((n - 0.48) * 3.2, 0, 1)
    rgba = np.zeros((s, s, 4))
    rgba[..., :3] = 255
    rgba[..., 3] = a * 255
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("textures", "clouds.png"))


def tex_window_lit():
    s = 128
    img = Image.new("RGB", (s, s), (255, 190, 110))
    d = ImageDraw.Draw(img)
    a = radial(s, 0, 1.2)
    base = np.stack([255 * (0.6 + 0.4 * a), 170 * (0.5 + 0.5 * a), 80 * (0.4 + 0.6 * a)], -1)
    img = Image.fromarray(base.astype(np.uint8))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, s - 1, s - 1], outline=(40, 26, 16), width=8)
    d.line([s // 2, 0, s // 2, s], fill=(40, 26, 16), width=6)
    d.line([0, s // 2, s, s // 2], fill=(40, 26, 16), width=6)
    img.save(out("textures", "window_lit.jpg"), quality=88)


def tex_window_dark():
    s = 128
    n = fbm(s, 4, 3, seed=160)
    v = 0.1 + n * 0.12
    base = np.stack([v * 255 * 0.9, v * 255 * 0.8, v * 255 * 0.7], -1)
    img = Image.fromarray(base.astype(np.uint8))
    d = ImageDraw.Draw(img)
    # curtain hint
    d.rectangle([8, 8, 34, s - 8], fill=(90, 34, 28))
    d.rectangle([s - 34, 8, s - 8, s - 8], fill=(90, 34, 28))
    d.rectangle([0, 0, s - 1, s - 1], outline=(52, 36, 22), width=8)
    d.line([s // 2, 0, s // 2, s], fill=(52, 36, 22), width=5)
    img.save(out("textures", "window_dark.jpg"), quality=88)


# ---------------------------------------------------------------- signs & UI art
def font(path, size):
    return ImageFont.truetype(path, size)


def wood_board(w, h, seed):
    g1 = stretch_noise(w, h, 6, 36, seed)
    g2 = stretch_noise(w, h, 14, 120, seed + 1)
    v = g1 * 0.55 + g2 * 0.45
    v = v * 0.7 + (np.sin(v * 50) * 0.5 + 0.5) * 0.3
    col = colorize(v, [(0, (70, 44, 26)), (0.5, (110, 72, 42)), (1, (150, 104, 62))])
    return Image.fromarray(col.astype(np.uint8))


def make_sign(text, name, paint=(236, 214, 160), board_tint=None, w=1024, h=256):
    img = wood_board(w, h, abs(hash(name)) % 1000)
    if board_tint:
        ov = Image.new("RGB", (w, h), board_tint)
        img = Image.blend(img, ov, 0.35)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=(36, 22, 12), width=14)
    d.rectangle([18, 18, w - 19, h - 19], outline=paint, width=4)
    size = 150
    f = font(FONT_RYE, size)
    while d.textlength(text, font=f) > w - 120 and size > 40:
        size -= 6
        f = font(FONT_RYE, size)
    tw = d.textlength(text, font=f)
    bbox = d.textbbox((0, 0), text, font=f)
    th = bbox[3] - bbox[1]
    x = (w - tw) / 2
    y = (h - th) / 2 - bbox[1]
    d.text((x + 5, y + 6), text, font=f, fill=(30, 18, 10))
    d.text((x, y), text, font=f, fill=paint)
    # weathering
    arr = np.array(img).astype(float)
    wear = fbm(256, 8, 4, seed=abs(hash(name)) % 997)
    wear = np.array(Image.fromarray((wear * 255).astype(np.uint8)).resize((w, h))) / 255.0
    arr *= (0.78 + wear[..., None] * 0.3)
    save_rgb(arr, out("textures", f"sign_{name}.jpg"))


def make_logo():
    W, H = 1800, 760
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # crosshair emblem behind the title
    em = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(em)
    cx, cy, R = W // 2, 330, 300
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(140, 26, 18, 210), width=22)
    d.ellipse([cx - R + 46, cy - R + 46, cx + R - 46, cy + R - 46], outline=(140, 26, 18, 120), width=6)
    for a in range(4):
        ang = a * math.pi / 2
        x0, y0 = cx + math.cos(ang) * (R - 90), cy + math.sin(ang) * (R - 90)
        x1, y1 = cx + math.cos(ang) * (R + 70), cy + math.sin(ang) * (R + 70)
        d.line([x0, y0, x1, y1], fill=(140, 26, 18, 230), width=18)
    # sheriff star in the middle
    pts = []
    for i in range(10):
        r = 120 if i % 2 == 0 else 52
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.polygon(pts, fill=(120, 22, 14, 160))
    em = em.filter(ImageFilter.GaussianBlur(1.2))
    img.alpha_composite(em)

    def gold_text(text, size, y, tracking=0, palette=((255, 244, 196), (240, 190, 90), (170, 100, 30), (250, 210, 120))):
        f = font(FONT_RYE, size)
        tmp = Image.new("L", (W, H), 0)
        td = ImageDraw.Draw(tmp)
        # manual letter spacing
        widths = [td.textlength(ch, font=f) for ch in text]
        total = sum(widths) + tracking * (len(text) - 1)
        x = (W - total) / 2
        for ch, wch in zip(text, widths):
            td.text((x, y), ch, font=f, fill=255)
            x += wch + tracking
        mask = tmp
        bbox = mask.getbbox()
        # outline
        outline = mask.filter(ImageFilter.MaxFilter(23))
        shadow = outline.filter(ImageFilter.GaussianBlur(10))
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sh.putalpha(shadow.point(lambda p: int(p * 0.85)))
        img.alpha_composite(sh, (8, 14))
        ol = Image.new("RGBA", (W, H), (34, 16, 8, 255))
        ol.putalpha(outline)
        img.alpha_composite(ol)
        inner = mask.filter(ImageFilter.MaxFilter(7))
        il = Image.new("RGBA", (W, H), (110, 52, 18, 255))
        il.putalpha(inner)
        img.alpha_composite(il)
        # gradient fill
        y0, y1 = bbox[1], bbox[3]
        grad = np.zeros((H, W, 4))
        ys = np.clip((np.arange(H) - y0) / max(1, (y1 - y0)), 0, 1)
        stops = [(0, palette[0]), (0.45, palette[1]), (0.55, palette[2]), (1, palette[3])]
        colrow = colorize(ys[:, None].repeat(1, 1), stops)[:, 0, :]
        grad[..., :3] = colrow[:, None, :]
        grad[..., 3] = np.array(mask)
        gi = Image.fromarray(grad.astype(np.uint8), "RGBA")
        img.alpha_composite(gi)
        # specular highlight line
        hl = mask.filter(ImageFilter.MinFilter(5))
        hlarr = np.array(hl).astype(float)
        hlarr[int(y0 + (y1 - y0) * 0.22):, :] = 0
        hli = Image.new("RGBA", (W, H), (255, 255, 240, 0))
        hli.putalpha(Image.fromarray((hlarr * 0.45).astype(np.uint8)))
        img.alpha_composite(hli)

    gold_text("COWBOY", 250, 60, tracking=6)
    gold_text("SNIPER", 250, 300, tracking=10)
    # ELITE banner ribbon
    rb = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rb)
    by0, by1 = 585, 715
    rd.polygon([(430, by0 + 10), (W - 430, by0 + 10), (W - 380, (by0 + by1) // 2 + 5), (W - 430, by1), (430, by1), (380, (by0 + by1) // 2 + 5)], fill=(118, 20, 14, 255))
    rd.polygon([(440, by0 + 22), (W - 440, by0 + 22), (W - 400, (by0 + by1) // 2 + 5), (W - 440, by1 - 12), (440, by1 - 12), (400, (by0 + by1) // 2 + 5)], outline=(232, 186, 98, 255), width=5)
    img.alpha_composite(rb)
    f = font(FONT_RYE, 104)
    d2 = ImageDraw.Draw(img)
    text = "E L I T E"
    tw = d2.textlength(text, font=f)
    d2.text(((W - tw) / 2 + 4, 592 + 5), text, font=f, fill=(40, 8, 4, 255))
    d2.text(((W - tw) / 2, 592), text, font=f, fill=(255, 226, 150, 255))
    img = img.crop(img.getbbox())
    img.save(out("ui", "logo.png"), optimize=True)
    small = img.resize((img.width // 3, img.height // 3), Image.LANCZOS)
    small.save(out("ui", "logo_small.png"), optimize=True)


def make_button(name, top, bottom, border, w=480, h=120):
    s = 2
    W, H = w * s, h * s
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([6, 6, W - 7, H - 7], radius=26, fill=255)
    grad = np.zeros((H, W, 4))
    t = np.linspace(0, 1, H)[:, None]
    for i in range(3):
        grad[..., i] = (top[i] * (1 - t) + bottom[i] * t)
    n = fbm(256, 8, 4, seed=hash(name) % 1000)
    n = np.array(Image.fromarray((n * 255).astype(np.uint8)).resize((W, H))) / 255.0
    grad[..., :3] *= (0.9 + n[..., None] * 0.16)
    grad[..., 3] = np.array(mask)
    body = Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8), "RGBA")
    img.alpha_composite(body)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([6, 6, W - 7, H - 7], radius=26, outline=border, width=8)
    d.rounded_rectangle([20, 20, W - 21, H - 21], radius=18, outline=tuple(min(255, c + 60) for c in border) + (120,), width=3)
    # gloss
    gl = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(gl)
    gd.rounded_rectangle([24, 22, W - 25, H // 2], radius=16, fill=60)
    gl = gl.filter(ImageFilter.GaussianBlur(6))
    gli = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    gli.putalpha(gl)
    img.alpha_composite(gli)
    # rivets
    for x in (34, W - 34):
        d.ellipse([x - 8, H // 2 - 8, x + 8, H // 2 + 8], fill=tuple(border) + (255,))
        d.ellipse([x - 4, H // 2 - 6, x + 2, H // 2], fill=(255, 240, 200, 200))
    img = img.resize((w, h), Image.LANCZOS)
    img.save(out("ui", f"btn_{name}.png"), optimize=True)


def make_poster():
    W, H = 600, 820
    base = Image.open(out("ui", "parchment.jpg")).resize((W, H)).convert("RGBA")
    arr = np.array(base).astype(float)
    y, x = np.mgrid[0:H, 0:W]
    dx = np.minimum(x, W - 1 - x) / 60
    dy = np.minimum(y, H - 1 - y) / 60
    edge = np.clip(np.minimum(dx, dy), 0, 1)
    burn = fbm(256, 6, 5, seed=170)
    burn = np.array(Image.fromarray((burn * 255).astype(np.uint8)).resize((W, H))) / 255.0
    darken = np.clip(1 - edge, 0, 1) ** 1.5 * (0.6 + burn * 0.6)
    arr[..., :3] *= (1 - np.clip(darken, 0, 0.8)[..., None])
    # ragged alpha edge
    rag = (edge * 8 + burn * 0.8) > 0.6
    arr[..., 3] = np.where(rag, 255, 0)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    d = ImageDraw.Draw(img)
    f1 = font(FONT_RYE, 110)
    t = "WANTED"
    tw = d.textlength(t, font=f1)
    d.text(((W - tw) / 2, 40), t, font=f1, fill=(52, 24, 12, 255))
    f2 = font(FONT_RYE, 36)
    t = "DEAD OR ALIVE"
    tw = d.textlength(t, font=f2)
    d.text(((W - tw) / 2, 170), t, font=f2, fill=(110, 30, 18, 255))
    d.rectangle([90, 230, W - 90, 590], outline=(52, 24, 12, 255), width=6)
    # nail hole
    d.ellipse([W / 2 - 9, 12, W / 2 + 9, 30], fill=(40, 30, 24, 255))
    img.save(out("ui", "wanted_poster.png"), optimize=True)


def make_star_badge():
    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = s / 2

    def star(r1, r2, fill, outline=None, width=0):
        pts = []
        for i in range(10):
            r = r1 if i % 2 == 0 else r2
            a = -math.pi / 2 + i * math.pi / 5
            pts.append((c + math.cos(a) * r, c + math.sin(a) * r))
        d.polygon(pts, fill=fill, outline=outline, width=width)
        return pts

    pts = star(120, 54, (150, 96, 26, 255))
    star(108, 48, (236, 186, 84, 255))
    star(80, 36, (255, 222, 140, 255))
    for i, p in enumerate(pts):
        if i % 2 == 0:
            d.ellipse([p[0] - 12, p[1] - 12, p[0] + 12, p[1] + 12], fill=(236, 186, 84, 255), outline=(150, 96, 26, 255), width=3)
    d.ellipse([c - 30, c - 30, c + 30, c + 30], outline=(150, 96, 26, 255), width=5)
    img.save(out("icons", "star_badge.png"), optimize=True)


def make_bullet_icon():
    w, h = 64, 200
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([10, 70, w - 10, h - 8], radius=6, fill=(196, 140, 52, 255), outline=(110, 70, 20, 255), width=3)
    d.rectangle([10, h - 30, w - 10, h - 20], fill=(150, 100, 30, 255))
    d.pieslice([10, 4, w - 10, 140], 180, 360, fill=(170, 120, 96, 255), outline=(90, 60, 40, 255), width=3)
    d.rectangle([10, 72 - 2, w - 10, 76], fill=(110, 70, 20, 255))
    d.rectangle([16, 80, 22, h - 36], fill=(250, 214, 140, 180))
    img.save(out("icons", "bullet.png"), optimize=True)


def make_coin_icon():
    s = 128
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, s - 4, s - 4], fill=(170, 112, 26, 255))
    d.ellipse([10, 10, s - 10, s - 10], fill=(244, 196, 80, 255))
    d.ellipse([18, 18, s - 18, s - 18], outline=(190, 130, 36, 255), width=4)
    f = font(FONT_RYE, 64)
    tw = d.textlength("$", font=f)
    d.text(((s - tw) / 2, 22), "$", font=f, fill=(150, 92, 20, 255))
    img.save(out("icons", "coin.png"), optimize=True)


def make_menu_vignette():
    W, H = 1024, 576
    y, x = np.mgrid[0:H, 0:W]
    dx = (x - W / 2) / (W / 2)
    dy = (y - H / 2) / (H / 2)
    r = np.sqrt(dx * dx * 0.8 + dy * dy)
    a = np.clip((r - 0.55) / 0.75, 0, 1) ** 1.6
    rgba = np.zeros((H, W, 4))
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 18, 8, 4
    rgba[..., 3] = a * 235
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("ui", "vignette.png"), optimize=True)


def make_grain():
    s = 256
    n = rng.random((s, s))
    rgba = np.zeros((s, s, 4))
    rgba[..., :3] = (n[..., None] * 255)
    rgba[..., 3] = 26
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(out("ui", "film_grain.png"), optimize=True)


def make_scope_lens():
    """Lens dirt/scratches overlay for scoped view."""
    s = 1024
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for _ in range(60):
        x, y = random.uniform(0, s), random.uniform(0, s)
        r = random.uniform(4, 30)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 240, 220, random.randint(4, 14)))
    for _ in range(18):
        x, y = random.uniform(0, s), random.uniform(0, s)
        a = random.uniform(0, math.tau)
        ln = random.uniform(30, 140)
        d.line([x, y, x + math.cos(a) * ln, y + math.sin(a) * ln], fill=(255, 255, 255, 18), width=1)
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    img.save(out("ui", "scope_dirt.png"), optimize=True)


def main():
    print("textures…")
    tex_sand(); tex_wood(); tex_adobe(); tex_brick(); tex_tin(); tex_rock(); tex_cloth()
    tex_leather(); tex_parchment(); tex_ground_detail(); tex_window_lit(); tex_window_dark()
    print("sprites…")
    sprite_smoke(); sprite_dust(); sprite_flash(); sprite_glint(); sprite_spark(); sprite_blood()
    sprite_tumbleweed(); sprite_mesa(); sprite_clouds()
    print("signs…")
    signs = [
        ("SALOON", "saloon", (236, 214, 160), None),
        ("BANK", "bank", (240, 210, 120), (30, 50, 40)),
        ("SHERIFF", "sheriff", (240, 220, 170), None),
        ("HOTEL", "hotel", (250, 236, 200), (90, 30, 26)),
        ("GENERAL STORE", "store", (236, 214, 160), None),
        ("UNDERTAKER", "undertaker", (210, 210, 200), (20, 20, 20)),
        ("BLACKSMITH", "blacksmith", (236, 200, 150), None),
        ("STATION", "station", (250, 236, 200), (30, 40, 70)),
        ("ASSAY OFFICE", "assay", (240, 220, 160), None),
        ("TELEGRAPH", "telegraph", (236, 214, 160), (50, 60, 40)),
        ("BARBER", "barber", (250, 240, 230), (120, 20, 20)),
        ("LIVERY", "livery", (236, 214, 160), None),
    ]
    for text, name, paint, tint in signs:
        make_sign(text, name, paint, tint)
    print("ui…")
    make_logo()
    make_button("gold", (250, 206, 110), (176, 110, 34), (90, 50, 14))
    make_button("red", (196, 60, 40), (110, 20, 14), (60, 10, 6))
    make_button("dark", (88, 64, 46), (40, 28, 20), (20, 12, 8))
    make_poster(); make_star_badge(); make_bullet_icon(); make_coin_icon()
    make_menu_vignette(); make_grain(); make_scope_lens()
    print("done")


if __name__ == "__main__":
    main()
