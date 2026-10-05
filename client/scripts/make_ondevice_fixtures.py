"""Reference values for src/ondevice/preprocess.js, computed with the same libraries the inference service uses
(Pillow resize, OpenCV colour conversions, inference/quality.py). Re-run after changing a guard or the resize:
    python client/scripts/make_ondevice_fixtures.py   (needs numpy, pillow, opencv-python-headless)"""
import base64, json, os, sys
import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "inference"))
import quality as Q  # noqa: E402

rng = np.random.default_rng(0)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a, dtype=np.uint8).tobytes()).decode()

# A textured, partly skin-toned image (gradient + noise + a few blobs), small enough to keep the fixture light.
H, W = 120, 160
yy, xx = np.mgrid[0:H, 0:W]
img = np.stack([150 + 60 * np.sin(xx / 9), 110 + 40 * np.cos(yy / 7), 80 + 30 * np.sin((xx + yy) / 11)], -1)
img += rng.normal(0, 18, img.shape)
img[20:60, 30:90] = [60, 140, 200]   # a non-skin (blue) patch
img = np.clip(img, 0, 255).astype(np.uint8)
pil = Image.fromarray(img)

resizes = []
for ow, oh in [(96, 80), (200, 150), (64, 64), (160, 90)]:  # down/down, up/up, square, width-only
    resizes.append({"w": ow, "h": oh, "rgb": b64(np.array(pil.resize((ow, oh), Image.BILINEAR)))})

px = rng.integers(0, 256, (4096, 1, 3), dtype=np.uint8)
px[:256, 0] = [[r, g, b] for r in (0, 255, 128, 37) for g in (0, 255, 128, 200) for b in range(0, 256, 16)][:256]
bgr = cv2.cvtColor(px, cv2.COLOR_RGB2BGR)
hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)

cv_img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
logit_cases = []
for scale in (0.3, 1.0, 3.0):
    lo = rng.normal(0, scale, 7)
    p = np.exp(lo - lo.max()); p /= p.sum()
    s = np.sort(p)[::-1]
    ent = Q.entropy_from_probs(p.tolist())
    energy = float(np.log(np.exp(lo - lo.max()).sum()) + lo.max())
    logit_cases.append({"logits": lo.tolist(), "entropy": ent, "energy": energy,
                        "status": Q.assess_prediction(float(s[0]), float(s[0] - s[1]), ent, energy)})

json.dump({
    "image": {"w": W, "h": H, "rgb": b64(img)},
    "resizes": resizes,
    "pixels": {"rgb": b64(px), "hsv": b64(hsv), "ycrcb": b64(ycc)},
    "skin_ratio": Q.skin_ratio(pil),
    "blur": {"full": Q.check_image_blur(cv_img, max_side=512), "max_side_100": Q.check_image_blur(cv_img, max_side=100)},
    "guards": {"low_confidence_threshold": Q.LOW_CONFIDENCE_THRESHOLD, "ood_entropy_threshold": Q.OOD_ENTROPY_THRESHOLD,
               "ood_margin_threshold": Q.OOD_MARGIN_THRESHOLD, "ood_energy_threshold": Q.OOD_ENERGY_THRESHOLD},
    "logit_cases": logit_cases,
}, open(os.path.join(HERE, "..", "src", "__tests__", "fixtures", "ondevice.json"), "w"))
print("ok")
