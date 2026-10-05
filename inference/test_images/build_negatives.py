"""Build a synthetic negative test set for the skin-detection guard eval.

We don't have real non-medical photos (cars, memes, pets, food) available in
this repo/environment, so this builds two groups instead:

1. "skin_toned_*" — solid colors, gradients, and coarse noise sampled from the
   exact tan/beige/desert color range that fooled is_skin_image on the G-Wagon
   photo per the teammate's analysis. This directly tests the documented
   failure mode (skin-color false positives from non-skin content), even
   though it's synthetic rather than a real desert/car photo.
2. "non_skin_toned_*" — solid colors and gradients clearly outside any skin
   tone range (blues, greens, purples), as a sanity-check baseline that
   should obviously be rejected.

This is NOT a substitute for real negative photos (cars/memes/pets/food/faces/
landscapes) — it only exercises the specific HSV/YCrCb color-range mechanism
the guard uses, not real-world image content/texture diversity.
"""
import os
import random
from PIL import Image, ImageDraw

random.seed(0)
OUT_DIR = os.path.join(os.path.dirname(__file__), "negative")
os.makedirs(OUT_DIR, exist_ok=True)

SIZE = (512, 512)

# Tan/beige/desert-ish RGB samples (the color range the analysis says fools
# the HSV+YCrCb skin mask: sand, dirt, light wood, cardboard, road).
SKIN_TONED_COLORS = [
    (210, 180, 140), (222, 184, 135), (194, 154, 108), (160, 120, 90),
    (205, 170, 125), (188, 143, 99), (170, 130, 95), (200, 165, 130),
]

# Clearly non-skin-toned colors.
NON_SKIN_COLORS = [
    (30, 60, 140), (20, 110, 60), (90, 30, 120), (10, 10, 10),
    (240, 240, 245), (40, 160, 200), (120, 20, 20), (15, 90, 90),
]


def solid(path, color):
    Image.new("RGB", SIZE, color).save(path)


def gradient(path, c1, c2):
    img = Image.new("RGB", SIZE)
    for y in range(SIZE[1]):
        t = y / SIZE[1]
        row = tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3))
        for x in range(SIZE[0]):
            img.putpixel((x, y), row)
    img.save(path)


def noisy_patchwork(path, palette):
    """Coarse random patches of a palette, closer to a textured photo than a
    flat solid fill (sand/dirt/road have variation, not one flat color)."""
    img = Image.new("RGB", SIZE)
    draw = ImageDraw.Draw(img)
    patch = 24
    for y in range(0, SIZE[1], patch):
        for x in range(0, SIZE[0], patch):
            base = random.choice(palette)
            jitter = tuple(max(0, min(255, c + random.randint(-15, 15))) for c in base)
            draw.rectangle([x, y, x + patch, y + patch], fill=jitter)
    img.save(path)


n = 0
for i, c in enumerate(SKIN_TONED_COLORS):
    solid(os.path.join(OUT_DIR, f"skin_toned_solid_{i}.png"), c)
    n += 1
for i in range(4):
    c1, c2 = random.sample(SKIN_TONED_COLORS, 2)
    gradient(os.path.join(OUT_DIR, f"skin_toned_gradient_{i}.png"), c1, c2)
    n += 1
for i in range(6):
    noisy_patchwork(os.path.join(OUT_DIR, f"skin_toned_patchwork_{i}.png"), SKIN_TONED_COLORS)
    n += 1

for i, c in enumerate(NON_SKIN_COLORS):
    solid(os.path.join(OUT_DIR, f"non_skin_solid_{i}.png"), c)
    n += 1
for i in range(4):
    c1, c2 = random.sample(NON_SKIN_COLORS, 2)
    gradient(os.path.join(OUT_DIR, f"non_skin_gradient_{i}.png"), c1, c2)
    n += 1
for i in range(6):
    noisy_patchwork(os.path.join(OUT_DIR, f"non_skin_patchwork_{i}.png"), NON_SKIN_COLORS)
    n += 1

print(f"wrote {n} synthetic negatives to {OUT_DIR}")
