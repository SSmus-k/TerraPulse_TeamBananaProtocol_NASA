"""Cut the four pillars and the floor out of the team artwork onto their own layers, and build a background
plate with the pillar niches filled in, so each piece can move independently in the UI.

The cutouts use a soft matte (the pillar plus the glow it casts into the dark niche) and their colours are
solved against the plate:  fg = (original - (1 - a) * plate) / a.  At rest, layering the cutouts over the
plate therefore reproduces the original artwork exactly; only when a piece moves does the niche show.

usage: python scripts/art/cutouts.py public/assets/orbit-window.webp public/assets/cockpit
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
orig = np.array(Image.open(src).convert("RGB")).astype(np.float32)
H, W = orig.shape[:2]
lum = 0.299 * orig[..., 0] + 0.587 * orig[..., 1] + 0.114 * orig[..., 2]

# generous search boxes around each painted pillar (image px: x0, y0, x1, y1)
SEARCH = [(60, 250, 225, 790), (240, 290, 435, 830), (430, 320, 630, 860), (630, 340, 768, 870)]
THRESH = 46          # silver face vs dark niche
GLOW = 20            # px of glow carried with each pillar
LUM_LO, LUM_HI = 9, 58


def hard_mask(box):
    x0, y0, x1, y1 = box
    m = lum[y0:y1, x0:x1] > THRESH
    m = ndi.binary_closing(m, structure=np.ones((9, 9)), iterations=2)
    m = ndi.binary_fill_holes(m)
    lab, n = ndi.label(m)
    m = lab == (int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))) + 1)
    for r in np.where(m.any(axis=1))[0]:          # columns are convex: fill each row
        xs = np.where(m[r])[0]
        m[r, xs.min():xs.max() + 1] = True
    m = ndi.gaussian_filter(m.astype(np.float32), 2.5) > 0.5   # smooth the stair-stepped outline
    full = np.zeros((H, W), bool)
    full[y0:y1, x0:x1] = m
    return full


def lean_of(mask):
    ys, xs = np.where(mask)
    y0, y1 = ys.min(), ys.max()
    rows = [int(y0 + (y1 - y0) * f) for f in (0.15, 0.85)]
    mids = [(np.where(mask[r])[0].min() + np.where(mask[r])[0].max()) / 2 for r in rows]
    return float(np.degrees(np.arctan((mids[1] - mids[0]) / (rows[1] - rows[0]))))


# ---- mattes -------------------------------------------------------------------------------------------
# distance (px) outside the window's outer rim; the glass circle is centre (1778, 471), r 974, rim ~30 px wide
yy, xx = np.mgrid[0:H, 0:W]
rim_dist = np.hypot(xx - 1778, yy - 471) - (974 + 30)  # > 0 = in the room, left of the rim
hards, alphas = [], []
for box in SEARCH:
    hm = hard_mask(box)
    region = ndi.binary_dilation(hm, iterations=GLOW)
    x0, y0, x1, y1 = box
    clip = np.zeros((H, W), bool)
    clip[y0:y1, x0:x1] = True
    region_soft = ndi.gaussian_filter((region & clip).astype(np.float32), GLOW / 3)
    lum_a = np.clip((lum - LUM_LO) / (LUM_HI - LUM_LO), 0, 1)
    # never carry the window's bright rim along with a pillar (it would move and shimmer)
    lum_a = lum_a * np.clip((rim_dist - 18) / 14, 0, 1)
    a = np.maximum(ndi.gaussian_filter(hm.astype(np.float32), 1.0), lum_a * region_soft)
    a[a < 0.02] = 0
    hards.append(hm)
    alphas.append(a)

FLOOR = [(0, 805), (150, 798), (300, 820), (450, 850), (585, 880), (640, 920), (685, 1000), (730, 1080),
         (778, 1160), (815, 1240), (0, 1240)]
fm = np.zeros((H, W), np.uint8)
cv2.fillPoly(fm, [np.array(FLOOR, np.int32)], 1)
floor_a = np.clip(ndi.gaussian_filter(fm.astype(np.float32), 1.0), 0, 1)

# ---- plate: fill the niches, sink the floor ------------------------------------------------------------
union = np.maximum.reduce(alphas)
hole = ndi.binary_dilation(union > 0.02, iterations=3).astype(np.uint8) * 255
plate = cv2.inpaint(cv2.cvtColor(orig.astype(np.uint8), cv2.COLOR_RGB2BGR), hole, 15, cv2.INPAINT_TELEA)
plate = cv2.cvtColor(plate, cv2.COLOR_BGR2RGB).astype(np.float32)
recess = ndi.gaussian_filter(np.maximum.reduce(hards).astype(np.float32), 8)
plate *= (1 - 0.55 * np.clip(recess * 1.4, 0, 1))[..., None]        # niches read as recesses
plate *= (1 - 0.7 * floor_a)[..., None]                               # the floor's bed is in shadow
plate = np.clip(plate, 0, 255)
Image.fromarray(plate.astype(np.uint8)).save(out / "plate.webp", "WEBP", quality=92, method=6)


def save_layer(a, name, pad=2):
    ys, xs = np.where(a > 0.01)
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
    aa = a[y0:y1, x0:x1][..., None]
    o, p = orig[y0:y1, x0:x1], plate[y0:y1, x0:x1]
    fg = np.where(aa > 0.02, (o - (1 - aa) * p) / np.maximum(aa, 0.02), 0)
    rgba = np.dstack([np.clip(fg, 0, 255), aa[..., 0] * 255]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(out / f"{name}.webp", "WEBP", lossless=True, method=6)
    return dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0))


def save_mask(m, box, name):
    """Silhouette (no glow) as an alpha PNG, cropped to the layer's box, for CSS shadows and light."""
    s = np.clip(ndi.gaussian_filter(m.astype(np.float32), 1.2), 0, 1)[box["y"]:box["y"] + box["h"], box["x"]:box["x"] + box["w"]]
    m8 = (s * 255).astype(np.uint8)
    Image.fromarray(np.dstack([np.full_like(m8, 255)] * 3 + [m8]), "RGBA").save(out / f"{name}-mask.png", optimize=True)


meta = {"image": {"w": W, "h": H}, "pillars": [], "floor": None}
for i, (hm, a) in enumerate(zip(hards, alphas), 1):
    box = save_layer(a, f"pillar-{i}")
    save_mask(hm, box, f"pillar-{i}")
    meta["pillars"].append({"sprite": box, "leanDeg": lean_of(hm)})
fbox = save_layer(floor_a, "floor", pad=1)
save_mask(fm.astype(bool), fbox, "floor")
meta["floor"] = {"sprite": fbox, "outline": FLOOR}

# check: the layers over the plate must give back the original
comp = plate.copy()
for i, a in enumerate(alphas + [floor_a]):
    name = f"pillar-{i + 1}" if i < len(alphas) else "floor"
    b = meta["pillars"][i]["sprite"] if i < len(alphas) else fbox
    layer = np.array(Image.open(out / f"{name}.webp").convert("RGBA")).astype(np.float32)
    la = layer[..., 3:] / 255
    sl = (slice(b["y"], b["y"] + b["h"]), slice(b["x"], b["x"] + b["w"]))
    comp[sl] = comp[sl] * (1 - la) + layer[..., :3] * la
meta["reconstructionMeanAbsError"] = float(np.abs(comp - orig).mean())
(out / "layout.json").write_text(json.dumps(meta, indent=2))
print(json.dumps(meta, indent=1))
