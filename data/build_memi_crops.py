"""Crop MEMI-DS melasma face photos to lesion-centred squares using the dataset's segmentation masks.
Full-face 3456x5184 shots would shrink lesions to a few pixels at model input size; our other melasma
images are close-ups. One crop per photo: square around the largest mask component, 15% margin, saved <=1024px.
The photos carry a grey pixelated eye-censor bar and a white calibration card - dataset-specific artefacts the
classifier could learn as a "melasma" shortcut - so each crop is then trimmed to the largest band of rows free
of light-grey low-saturation pixels; crops whose clean square is under MIN_SIDE are dropped."""
import os, numpy as np
from PIL import Image
from scipy import ndimage
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "raw", "MEMI-DS"); OUT = os.path.join(SRC, "crops"); os.makedirs(OUT, exist_ok=True)
for old in os.listdir(OUT): os.remove(os.path.join(OUT, old))
DS = 8  # find components on a downsampled mask
MIN_SIDE = 384


def strip_artefacts(c):
    hsv = np.asarray(c.convert("HSV"), dtype=np.float32) / 255
    grey = (hsv[..., 1] < 0.12) & (hsv[..., 2] > 0.55)
    frac = grey.mean(1); edge = np.zeros_like(frac, bool); e = len(frac) // 10; edge[:e] = edge[-e:] = True
    bad = (frac > 0.04) | (edge & (frac > 0.005))           # bar/card rows; card slivers hug the crop edge
    bad = ndimage.binary_dilation(bad, iterations=16)        # margin around the artefact
    lab, k = ndimage.label(~bad)
    if not k: return None
    sizes = ndimage.sum(~bad, lab, range(1, k + 1)); r = np.where(lab == 1 + np.argmax(sizes))[0]
    t, b = r.min(), r.max() + 1; side = min(b - t, c.width)
    if side < MIN_SIDE: return None
    top = t + (b - t - side) // 2; left = (c.width - side) // 2
    c = c.crop((left, top, left + side, top + side))
    # the calibration card's shadowed edge is slightly tinted and escapes the grey test above:
    # while light low-saturation pixels remain in the top 10%, shave 5% off the top and re-square
    for _ in range(6):
        a = np.asarray(c.convert("HSV"), dtype=np.float32) / 255
        lite = ((a[..., 1] < 0.2) & (a[..., 2] > 0.7)).mean(1)
        if not (lite[: c.height // 10] > 0.002).any(): break
        cut = c.height // 20; side = c.height - cut; left = (c.width - side) // 2
        c = c.crop((left, cut, left + side, c.height))
    return c if c.width >= MIN_SIDE else None

for f in sorted(x for x in os.listdir(SRC) if x.endswith(".jpg")):
    n = f[:-4]
    m = np.array(Image.open(os.path.join(SRC, "masks", n + ".png")))[::DS, ::DS] > 0
    lab, k = ndimage.label(m)
    if not k: print("empty mask", n); continue
    big = 1 + np.argmax(ndimage.sum(m, lab, range(1, k + 1)))
    ys, xs = np.where(lab == big); y0, y1, x0, x1 = ys.min() * DS, ys.max() * DS, xs.min() * DS, xs.max() * DS
    im = Image.open(os.path.join(SRC, f)).convert("RGB"); W, H = im.size
    side = int(max(y1 - y0, x1 - x0) * 1.15); side = min(side, W, H)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    left = min(max(cx - side // 2, 0), W - side); top = min(max(cy - side // 2, 0), H - side)
    c = im.crop((left, top, left + side, top + side)); c.thumbnail((1024, 1024))
    c = strip_artefacts(c)
    if c is None: print("dropped (too little clean area)", n); continue
    c.save(os.path.join(OUT, n + ".jpg"), quality=95)
print("crops:", len(os.listdir(OUT)))
