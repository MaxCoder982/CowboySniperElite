#!/usr/bin/env python3
"""Synthesises every sound effect and music loop for Cowboy Sniper Elite.

Run from the repo root:  python3 tools/gen_audio.py   (needs numpy + ffmpeg)
Outputs MP3 files into assets/audio/sfx and assets/audio/music.
"""
import math
import os
import subprocess
import tempfile
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 44100
rng = np.random.default_rng(1881)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env_exp(dur, decay, attack=0.002):
    t = t_axis(dur)
    a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / decay)


def noise(dur):
    return rng.uniform(-1, 1, int(SR * dur))


def lowpass(x, cutoff):
    """One-pole low-pass (cutoff Hz, may be an array)."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    y = np.zeros_like(x)
    acc = 0.0
    k = 1 - np.exp(-2 * math.pi * cutoff / SR)
    for i in range(len(x)):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def bandpass(x, lo, hi):
    return lowpass(highpass(x, lo), hi)


def reverb(x, room=0.35, decay=1.6, wet=0.35):
    """Cheap feedback-comb reverb."""
    out = np.copy(x)
    pad = np.zeros(int(SR * decay))
    sig = np.concatenate([x, pad])
    tail = np.zeros_like(sig)
    for d, g in ((0.0297, 0.78), (0.0371, 0.76), (0.0411, 0.74), (0.0437, 0.72)):
        n = int(d * SR * (1 + room))
        buf = np.zeros_like(sig)
        for i in range(n, len(sig)):
            buf[i] = sig[i - n] + g * buf[i - n]
        tail += buf
    tail = lowpass(tail, 4000) * 0.12
    res = sig * (1 - wet) + tail * wet
    return res


def comb_reverb_fast(x, decay=1.5, wet=0.3, delays=(0.031, 0.043, 0.057, 0.071), fb=0.7):
    """Vectorised-ish comb reverb via block feedback (faster for long music)."""
    pad = np.zeros(int(SR * decay))
    sig = np.concatenate([x, pad])
    tail = np.zeros_like(sig)
    for d in delays:
        n = int(d * SR)
        buf = sig.copy()
        # iterate in blocks of n samples (feedback only depends on samples n back)
        for start in range(n, len(sig), n):
            end = min(start + n, len(sig))
            buf[start:end] += fb * buf[start - n:end - n]
        tail += buf
    tail /= len(delays)
    tail = lowpass_fast(tail, 3500)
    return sig * (1 - wet) + tail * wet


def lowpass_fast(x, cutoff):
    # FFT brick-ish low-pass with soft rolloff
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def highpass_fast(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def write(x, folder, name, peak=0.9, bitrate="128k"):
    x = norm(x, peak)
    d = os.path.join(ROOT, "assets", "audio", folder)
    os.makedirs(d, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
    dst = os.path.join(d, name + ".mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-codec:a", "libmp3lame", "-b:a", bitrate, dst], check=True)
    os.unlink(path)
    print("  ", dst, f"{len(x) / SR:.2f}s")


# ------------------------------------------------------------------- SFX
def sfx_rifle_shot():
    dur = 2.2
    t = t_axis(dur)
    crack = noise(dur) * env_exp(dur, 0.012, 0.0005)
    body = lowpass_fast(noise(dur), 1800) * env_exp(dur, 0.09, 0.001) * 2.5
    thump = np.sin(2 * math.pi * (55 + 90 * np.exp(-t / 0.03)) * t) * env_exp(dur, 0.18, 0.001) * 1.6
    tail = lowpass_fast(noise(dur), 700) * env_exp(dur, 0.6, 0.02) * 0.9
    x = crack * 1.2 + body + thump + tail
    x = np.tanh(x * 1.8)
    x = comb_reverb_fast(x, 1.2, 0.35)[: int(SR * 2.4)]
    return x


def sfx_enemy_shot():
    dur = 1.6
    t = t_axis(dur)
    crack = highpass_fast(noise(dur), 900) * env_exp(dur, 0.008, 0.0005)
    body = bandpass_fast(noise(dur), 300, 2500) * env_exp(dur, 0.05) * 1.6
    thump = np.sin(2 * math.pi * (80 + 120 * np.exp(-t / 0.02)) * t) * env_exp(dur, 0.08) * 0.8
    x = np.tanh((crack + body + thump) * 2)
    return comb_reverb_fast(x, 1.4, 0.5, delays=(0.09, 0.13, 0.17, 0.23), fb=0.55)[: int(SR * 2.2)]


def bandpass_fast(x, lo, hi):
    return lowpass_fast(highpass_fast(x, lo), hi)


def click(dur, freq, decay, amp=1.0):
    t = t_axis(dur)
    tone = np.sin(2 * math.pi * freq * t) * env_exp(dur, decay * 0.8)
    n = highpass_fast(noise(dur), 2000) * env_exp(dur, decay * 0.4)
    return (tone * 0.6 + n) * amp


def place(buf, snd, at):
    i = int(at * SR)
    j = min(len(buf), i + len(snd))
    buf[i:j] += snd[: j - i]


def sfx_bolt():
    buf = np.zeros(int(SR * 0.75))
    place(buf, click(0.08, 1800, 0.02), 0.0)  # lift
    place(buf, bandpass_fast(noise(0.14), 800, 5000) * env_exp(0.14, 0.05) * 0.5, 0.05)  # slide back
    place(buf, click(0.06, 2400, 0.015, 1.2), 0.2)
    place(buf, click(0.1, 900, 0.03, 0.4), 0.26)  # shell ejection tink
    place(buf, np.sin(2 * math.pi * 3400 * t_axis(0.25)) * env_exp(0.25, 0.05) * 0.25, 0.32)
    place(buf, bandpass_fast(noise(0.12), 800, 5000) * env_exp(0.12, 0.04) * 0.5, 0.42)  # forward
    place(buf, click(0.07, 1500, 0.02, 1.3), 0.56)  # lock
    return buf


def sfx_reload():
    buf = np.zeros(int(SR * 1.2))
    for k in range(4):
        place(buf, click(0.09, 1300 + k * 60, 0.025, 0.9), 0.12 + k * 0.2)
        place(buf, bandpass_fast(noise(0.05), 1500, 6000) * env_exp(0.05, 0.015) * 0.4, 0.17 + k * 0.2)
    place(buf, click(0.08, 2000, 0.02, 1.2), 1.0)
    return buf


def sfx_dry_fire():
    return click(0.15, 2600, 0.01, 1.0)


def sfx_ricochet():
    dur = 0.9
    t = t_axis(dur)
    f = 2600 * np.exp(-t / 0.6) + 500
    ph = np.cumsum(2 * math.pi * f / SR)
    x = np.sin(ph) * env_exp(dur, 0.28, 0.003) * 0.7
    x += highpass_fast(noise(dur), 3000) * env_exp(dur, 0.01) * 0.8
    return x


def sfx_whiz():
    dur = 0.45
    t = t_axis(dur)
    e = np.exp(-((t - 0.16) / 0.06) ** 2)
    x = bandpass_fast(noise(dur), 1200, 5000) * e
    f = 1800 - 900 * t / dur
    x += np.sin(np.cumsum(2 * math.pi * f / SR)) * e * 0.15
    return x


def sfx_impact_body():
    dur = 0.35
    t = t_axis(dur)
    x = np.sin(2 * math.pi * (90 + 60 * np.exp(-t / 0.02)) * t) * env_exp(dur, 0.06)
    x += lowpass_fast(noise(dur), 1500) * env_exp(dur, 0.03) * 0.8
    return x


def sfx_headshot():
    dur = 0.9
    t = t_axis(dur)
    ding = (np.sin(2 * math.pi * 1760 * t) + 0.5 * np.sin(2 * math.pi * 2640 * t) + 0.3 * np.sin(2 * math.pi * 3520 * t)) * env_exp(dur, 0.25)
    thud = sfx_impact_body()
    x = ding * 0.35
    place(x, thud * 1.2, 0)
    return x


def sfx_impact_wood():
    dur = 0.4
    t = t_axis(dur)
    x = bandpass_fast(noise(dur), 300, 3000) * env_exp(dur, 0.03)
    x += np.sin(2 * math.pi * 220 * t) * env_exp(dur, 0.05) * 0.5
    return x


def sfx_impact_dirt():
    dur = 0.5
    x = lowpass_fast(noise(dur), 1200) * env_exp(dur, 0.06)
    x += highpass_fast(noise(dur), 3000) * env_exp(dur, 0.12, 0.02) * 0.15
    return x


def sfx_impact_metal():
    dur = 1.2
    t = t_axis(dur)
    x = sum(np.sin(2 * math.pi * f * t) * a for f, a in ((620, 1), (1530, 0.6), (2830, 0.4), (4100, 0.25)))
    x = x * env_exp(dur, 0.25)
    x += highpass_fast(noise(dur), 2500) * env_exp(dur, 0.01)
    return x


def sfx_explosion():
    dur = 3.0
    t = t_axis(dur)
    boom = lowpass_fast(noise(dur), 300) * env_exp(dur, 0.5, 0.005) * 3
    crack = noise(dur) * env_exp(dur, 0.04)
    sub = np.sin(2 * math.pi * (40 + 40 * np.exp(-t / 0.1)) * t) * env_exp(dur, 0.6) * 1.5
    debris = highpass_fast(noise(dur), 2000) * env_exp(dur, 0.8, 0.3) * 0.15 * (rng.random(len(t)) > 0.97)
    x = np.tanh((boom + crack + sub) * 1.5) + debris
    return comb_reverb_fast(x, 1.0, 0.3)[: int(SR * 3.2)]


def sfx_scope_in():
    dur = 0.35
    t = t_axis(dur)
    e = np.sin(np.clip(t / dur, 0, 1) * math.pi)
    x = bandpass_fast(noise(dur), 400, 2500) * e * 0.5
    place(x, click(0.05, 3000, 0.01, 0.6), 0.28)
    return x


def sfx_scope_out():
    x = sfx_scope_in()[::-1].copy()
    return x


def sfx_ui_click():
    return click(0.12, 1200, 0.02, 1.0) + click(0.12, 600, 0.03, 0.5)


def sfx_ui_hover():
    dur = 0.08
    t = t_axis(dur)
    return np.sin(2 * math.pi * 2200 * t) * env_exp(dur, 0.015) * 0.4


def sfx_coin():
    dur = 1.0
    t = t_axis(dur)
    x = np.zeros_like(t)
    for at, f in ((0.0, 1975), (0.09, 2637)):
        tt = np.clip(t - at, 0, None)
        e = (t >= at) * np.exp(-tt / 0.18)
        x += (np.sin(2 * math.pi * f * tt) + 0.4 * np.sin(2 * math.pi * f * 2 * tt)) * e
    return x


def sfx_cash():
    buf = np.zeros(int(SR * 1.4))
    place(buf, click(0.1, 900, 0.02, 1.0), 0.0)
    place(buf, bandpass_fast(noise(0.2), 2000, 8000) * env_exp(0.2, 0.05) * 0.4, 0.05)
    place(buf, sfx_coin() * 0.9, 0.2)
    return buf


def sfx_heartbeat():
    buf = np.zeros(int(SR * 1.0))
    for at, a in ((0.0, 1.0), (0.22, 0.7)):
        dur = 0.2
        t = t_axis(dur)
        b = np.sin(2 * math.pi * (50 + 20 * np.exp(-t / 0.03)) * t) * env_exp(dur, 0.06, 0.01) * a
        place(buf, b, at)
    return buf


def sfx_breath_in():
    dur = 0.9
    t = t_axis(dur)
    e = np.sin(np.clip(t / dur, 0, 1) * math.pi) ** 1.5
    return bandpass_fast(noise(dur), 500, 3500) * e * 0.5


def sfx_breath_out():
    dur = 1.1
    t = t_axis(dur)
    e = np.exp(-t / 0.4) * np.clip(t / 0.05, 0, 1)
    return bandpass_fast(noise(dur), 300, 2500) * e * 0.6


def sfx_deadeye():
    dur = 1.6
    t = t_axis(dur)
    f = 300 * np.exp(-t / 0.7) + 60
    x = np.sin(np.cumsum(2 * math.pi * f / SR)) * env_exp(dur, 0.7, 0.02)
    x += lowpass_fast(noise(dur), 400) * env_exp(dur, 0.5, 0.1) * 0.6
    x = comb_reverb_fast(x, 1.0, 0.4)[: int(SR * 2)]
    return x


def sfx_hurt():
    dur = 0.6
    t = t_axis(dur)
    x = lowpass_fast(noise(dur), 600) * env_exp(dur, 0.1) * 1.4
    x += np.sin(2 * math.pi * 70 * t) * env_exp(dur, 0.15)
    return x


def sfx_bell():
    dur = 3.0
    t = t_axis(dur)
    partials = ((220, 1.0), (440, 0.6), (530, 0.45), (660, 0.3), (880, 0.2), (1210, 0.12))
    x = sum(np.sin(2 * math.pi * f * t) * a * np.exp(-t / (1.8 - i * 0.2)) for i, (f, a) in enumerate(partials))
    return x


def sfx_horse():
    buf = np.zeros(int(SR * 1.6))
    for k in range(6):
        base = k * 0.26
        for off in (0, 0.06, 0.1):
            dur = 0.08
            t = t_axis(dur)
            b = lowpass_fast(noise(dur), 900) * env_exp(dur, 0.02) + np.sin(2 * math.pi * 120 * t) * env_exp(dur, 0.03) * 0.5
            place(buf, b, base + off)
    return buf


def sfx_whistle_train():
    dur = 2.2
    t = t_axis(dur)
    e = np.clip(t / 0.15, 0, 1) * np.clip((dur - t) / 0.4, 0, 1)
    x = np.zeros_like(t)
    for f in (466, 554, 698):
        x += np.sin(2 * math.pi * f * t + 0.003 * np.sin(2 * math.pi * 5 * t))
    x += bandpass_fast(noise(dur), 400, 2000) * 0.6
    return x * e


def sfx_victory():
    """Short trumpet-ish fanfare."""
    notes = [(0.0, 392, 0.18), (0.18, 523, 0.18), (0.36, 659, 0.18), (0.54, 784, 0.7)]
    buf = np.zeros(int(SR * 1.8))
    for at, f, d in notes:
        place(buf, brass(f, d), at)
    return comb_reverb_fast(buf, 1.0, 0.25)[: int(SR * 2.2)]


def sfx_defeat():
    notes = [(0.0, 392, 0.3), (0.3, 370, 0.3), (0.6, 349, 0.3), (0.9, 330, 1.0)]
    buf = np.zeros(int(SR * 2.2))
    for at, f, d in notes:
        place(buf, brass(f, d) * 0.8, at)
    return comb_reverb_fast(buf, 1.0, 0.3)[: int(SR * 2.6)]


def sfx_star():
    dur = 0.7
    t = t_axis(dur)
    f = 880 * (1 + t * 1.2)
    x = np.sin(np.cumsum(2 * math.pi * f / SR)) * env_exp(dur, 0.25)
    x += np.sin(np.cumsum(2 * math.pi * f * 1.5 / SR)) * env_exp(dur, 0.2) * 0.4
    return x


def sfx_wind_loop():
    dur = 8.0
    t = t_axis(dur)
    n = noise(dur)
    mod = 0.55 + 0.45 * np.sin(2 * math.pi * t / dur * 2) * np.sin(2 * math.pi * t / dur * 3 + 1)
    x = bandpass_fast(n, 150, 900) * mod
    # make seamless: crossfade end into start
    k = int(SR * 0.5)
    x[:k] = x[:k] * np.linspace(0, 1, k) + x[-k:] * np.linspace(1, 0, k)
    return x[: len(x) - k]


# ------------------------------------------------------------------- music
def ks_pluck(freq, dur, bright=0.5, decay=0.996):
    """Karplus-Strong plucked string."""
    n = int(SR * dur)
    p = max(2, int(SR / freq))
    seed = rng.uniform(-1, 1, p + 1)
    seed = lowpass_fast(seed, 2000 + bright * 6000) if p > 8 else seed
    y = np.zeros(n + 2 * p + 2)
    y[: p + 1] = seed
    # y[n] = decay * (y[n-p] + y[n-p-1]) / 2, computed one period at a time
    for start in range(p + 1, n + p + 1, p):
        y[start:start + p] = decay * 0.5 * (y[start - p:start] + y[start - p - 1:start - 1])
    return y[:n]


def brass(freq, dur):
    t = t_axis(dur + 0.15)
    vib = 1 + 0.004 * np.sin(2 * math.pi * 5.5 * t) * np.clip(t / 0.2, 0, 1)
    ph = np.cumsum(2 * math.pi * freq * vib / SR)
    x = sum(np.sin(ph * k) / k ** 1.1 for k in range(1, 9))
    e = np.clip(t / 0.03, 0, 1) * np.clip((dur + 0.15 - t) / 0.15, 0, 1)
    return lowpass_fast(x * e, 3000)


def whistle(freq, dur):
    t = t_axis(dur)
    vib = 1 + 0.008 * np.sin(2 * math.pi * 6 * t) * np.clip(t / 0.25, 0, 1)
    ph = np.cumsum(2 * math.pi * freq * vib / SR)
    x = np.sin(ph) + 0.05 * np.sin(2 * ph)
    x += bandpass_fast(noise(dur), freq * 0.8, freq * 1.3) * 0.08
    e = np.clip(t / 0.06, 0, 1) * np.clip((dur - t) / 0.12, 0, 1)
    return x * e


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def hz(name):
    """'A3' -> Hz."""
    n, o = name[:-1], int(name[-1])
    midi = NOTE[n] + (o + 1) * 12
    return 440 * 2 ** ((midi - 69) / 12)


def music_menu():
    """Spaghetti-western theme: guitar arpeggios in A minor, whistle melody, bell."""
    bpm = 92
    beat = 60 / bpm
    bars = 16
    total = bars * 4 * beat
    buf = np.zeros(int(SR * (total + 3)))
    chords = [["A2", "E3", "A3", "C4"], ["A2", "E3", "A3", "C4"], ["G2", "D3", "G3", "B3"], ["G2", "D3", "G3", "B3"],
              ["F2", "C3", "F3", "A3"], ["F2", "C3", "F3", "A3"], ["E2", "B2", "E3", "G#3"], ["E2", "B2", "E3", "G#3"]]
    pattern = [0, 2, 1, 3, 2, 1, 3, 2]
    for bar in range(bars):
        ch = chords[bar % 8]
        for i, p in enumerate(pattern):
            at = bar * 4 * beat + i * beat / 2
            place(buf, ks_pluck(hz(ch[p]), 1.4, 0.4) * (0.5 if i else 0.75), at)
        # bass on beats 1 and 3
        for b in (0, 2):
            place(buf, ks_pluck(hz(ch[0]) / 2 * 2, 1.6, 0.1, 0.997) * 0.9, bar * 4 * beat + b * beat)
    melody = [("E5", 1.5), ("A5", 0.5), ("G5", 1), ("E5", 1), ("D5", 2), ("C5", 1), ("D5", 1),
              ("E5", 3), (None, 1), ("A4", 1), ("C5", 1), ("E5", 1), ("G5", 1), ("F5", 2), ("E5", 1), ("D5", 1),
              ("E5", 4), ("E5", 1.5), ("A5", 0.5), ("G5", 1), ("E5", 1), ("D5", 2), ("C5", 1), ("B4", 1),
              ("A4", 3), (None, 1), ("C5", 1), ("B4", 1), ("A4", 1), ("G#4", 1), ("A4", 4)]
    at = 4 * 4 * beat  # melody enters at bar 5
    for n, d in melody:
        if n:
            place(buf, whistle(hz(n), d * beat * 0.95) * 0.45, at)
        at += d * beat
    # bell hits every 4 bars
    for bar in range(0, bars, 4):
        place(buf, sfx_bell() * 0.25, bar * 4 * beat)
    # light shaker
    for k in range(int(total / (beat / 2))):
        s = highpass_fast(noise(0.06), 5000) * env_exp(0.06, 0.015) * (0.12 if k % 2 else 0.06)
        place(buf, s, k * beat / 2)
    x = comb_reverb_fast(buf, 2.0, 0.3)
    loop = x[: int(SR * total)]
    tail = x[int(SR * total): int(SR * total) + int(SR * 2)]
    loop[: len(tail)] += tail * 0.8  # fold reverb tail for seamless loop
    return loop


def music_battle():
    """Tense gameplay loop: driving low guitar ostinato, tremolo, timpani."""
    bpm = 120
    beat = 60 / bpm
    bars = 16
    total = bars * 4 * beat
    buf = np.zeros(int(SR * (total + 3)))
    roots = ["D2", "D2", "C2", "D2", "D2", "D2", "A#1", "A1"]
    for bar in range(bars):
        r = hz(roots[bar % 8])
        for i in range(8):
            at = bar * 4 * beat + i * beat / 2
            acc = 1.0 if i in (0, 3, 6) else 0.55
            place(buf, ks_pluck(r * (2 if i in (3, 6) else 1), 0.6, 0.3, 0.993) * acc * 0.8, at)
        # timpani on 1
        dur = 1.2
        t = t_axis(dur)
        timp = np.sin(2 * math.pi * r * t) * env_exp(dur, 0.4) + lowpass_fast(noise(dur), 300) * env_exp(dur, 0.05)
        place(buf, timp * 0.7, bar * 4 * beat)
        if bar % 2 == 1:
            place(buf, timp * 0.5, bar * 4 * beat + 2.5 * beat)
    # tremolo high guitar line in second half
    line = ["A4", "A#4", "A4", "G4", "F4", "G4", "A4", "D5"]
    for bar in range(8, bars):
        f = hz(line[bar - 8])
        dur = 4 * beat
        t = t_axis(dur)
        trem = (np.sin(2 * math.pi * 12 * t) > 0).astype(float) * 0.6 + 0.4
        x = ks_pluck(f, dur, 0.6, 0.999) * 0 + np.sin(2 * math.pi * f * t) * trem
        x += 0.4 * np.sin(2 * math.pi * f * 2 * t) * trem
        x *= np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.2, 0, 1)
        place(buf, lowpass_fast(x, 2500) * 0.18, bar * 4 * beat)
    # brass stabs every 4 bars
    for bar in range(0, bars, 4):
        place(buf, brass(hz("D4"), beat * 1.5) * 0.25, bar * 4 * beat + 3 * beat)
        place(buf, brass(hz("A3"), beat * 1.5) * 0.2, bar * 4 * beat + 3 * beat)
    # hi-hat ticks
    for k in range(int(total / (beat / 2))):
        s = highpass_fast(noise(0.04), 6000) * env_exp(0.04, 0.01) * (0.15 if k % 2 else 0.08)
        place(buf, s, k * beat / 2)
    x = comb_reverb_fast(buf, 1.5, 0.22)
    loop = x[: int(SR * total)]
    tail = x[int(SR * total): int(SR * total) + int(SR * 1.5)]
    loop[: len(tail)] += tail * 0.8
    return loop


def main():
    print("sfx…")
    sfx = {
        "rifle_shot": sfx_rifle_shot, "enemy_shot": sfx_enemy_shot, "bolt": sfx_bolt, "reload": sfx_reload,
        "dry_fire": sfx_dry_fire, "ricochet": sfx_ricochet, "whiz": sfx_whiz, "impact_body": sfx_impact_body,
        "headshot": sfx_headshot, "impact_wood": sfx_impact_wood, "impact_dirt": sfx_impact_dirt,
        "impact_metal": sfx_impact_metal, "explosion": sfx_explosion, "scope_in": sfx_scope_in,
        "scope_out": sfx_scope_out, "ui_click": sfx_ui_click, "ui_hover": sfx_ui_hover, "coin": sfx_coin,
        "cash": sfx_cash, "heartbeat": sfx_heartbeat, "breath_in": sfx_breath_in, "breath_out": sfx_breath_out,
        "deadeye": sfx_deadeye, "hurt": sfx_hurt, "bell": sfx_bell, "horse": sfx_horse,
        "train_whistle": sfx_whistle_train, "victory": sfx_victory, "defeat": sfx_defeat, "star": sfx_star,
        "wind_loop": sfx_wind_loop,
    }
    for name, fn in sfx.items():
        write(fn(), "sfx", name, 0.95 if name not in ("ui_hover", "wind_loop") else 0.6, "96k")
    print("music…")
    write(music_menu(), "music", "theme_menu", 0.8, "112k")
    write(music_battle(), "music", "theme_battle", 0.8, "112k")


if __name__ == "__main__":
    main()
