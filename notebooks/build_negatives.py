"""Build the "not a skin lesion" class for train_dualkd.py --neg-*-csv.

Sources (downloaded into ../data/raw/negatives/, not in git):
  - DTD, Describable Textures Dataset (5,640 images, 47 texture classes): hard negatives - scaly, blotchy, cracked,
    stained surfaces look a lot like lesions.  https://www.robots.ox.ac.uk/~vgg/data/dtd/
  - COCO val2017 (5,000 everyday photos): scenes, objects, animals, food.  http://images.cocodataset.org/zips/val2017.zip
  - Oxford-IIIT Pet (7,390 close-up cat and dog photos), saved as negatives/oxford_pets/: fur filling the frame passes
    the skin-colour check and was the first real-world miss (a golden retriever puppy read as Eczema 70 %).
    https://thor.robots.ox.ac.uk/datasets/pets/images.tar.gz
  - People with normal skin (source "people"): LFW face photos (one per person, 3,000 sampled; downloaded by
    sklearn.datasets.fetch_lfw_people into negatives/lfw_home/) plus the COCO and Pet photos the CLIP filter below
    marks as faces or close-up skin. Added after a photo of a baby on an armchair was read as Eczema 68 %: without
    people in this set the model never learned that a photo of a person is not a lesion photo. Melasma photos are
    face photos too, so this source is only kept if Melasma recall does not drop (checked in fit_not_lesion_head.py).

COCO and Pet photos that CLIP sees mainly as a face or close-up skin are kept apart in the "people" source, so the
other sources' splits are unchanged and the effect of adding people can be measured on its own.
The held-out evaluation negatives (inference/test_images/negative/, real Unsplash photos + synthetic images) are never
used here, so they stay an honest out-of-distribution test.

Writes ../data/processed/negatives_{train,val,test}.csv (80/10/10 per source, seed 0).
    cd notebooks && python build_negatives.py
"""
import glob
import os

import numpy as np
import open_clip
import pandas as pd
import torch
from PIL import Image

ROOT = "../data/raw/negatives"
OUT = "../data/processed"
SKIN_PROMPTS = ["a close-up photo of human skin", "a close-up photo of a person's face",
                "a photo of a skin rash or skin disease", "a close-up photo of a hand or an arm"]
OTHER_PROMPTS = ["a photo of an object", "a photo of a scene", "a photo of an animal", "a photo of food",
                 "a photo of a room", "a photo of a street", "a photo of people in the distance", "a photo of a vehicle"]
SKIN_DROP = 0.5  # drop a COCO photo when this much of CLIP's probability goes to the skin/face prompts


@torch.no_grad()
def skin_scores(paths, device):
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32-quickgelu", pretrained="openai")
    model = model.to(device).eval()
    tok = open_clip.get_tokenizer("ViT-B-32-quickgelu")
    text = model.encode_text(tok(SKIN_PROMPTS + OTHER_PROMPTS).to(device))
    text = text / text.norm(dim=-1, keepdim=True)
    out = []
    for i in range(0, len(paths), 64):
        x = torch.stack([preprocess(Image.open(p).convert("RGB")) for p in paths[i:i + 64]]).to(device)
        f = model.encode_image(x)
        f = f / f.norm(dim=-1, keepdim=True)
        p = (model.logit_scale.exp() * f @ text.T).softmax(-1)
        out.append(p[:, :len(SKIN_PROMPTS)].sum(1).float().cpu())
    return torch.cat(out).numpy()


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtd = sorted(glob.glob(f"{ROOT}/dtd/images/*/*.jpg"))
    coco = sorted(glob.glob(f"{ROOT}/val2017/*.jpg"))
    score = skin_scores(coco, device)
    kept = [p for p, s in zip(coco, score) if s < SKIN_DROP]
    print(f"DTD {len(dtd)} | COCO {len(coco)}, dropped {len(coco) - len(kept)} face/skin-like, kept {len(kept)}")
    pets = []
    for p in sorted(glob.glob(f"{ROOT}/oxford_pets/*.jpg")):
        try:  # the archive has a few unreadable files
            Image.open(p).convert("RGB")
            pets.append(p)
        except Exception:
            pass
    pet_score = skin_scores(pets, device)
    pets_kept = [p for p, s in zip(pets, pet_score) if s < SKIN_DROP]
    print(f"Oxford-IIIT Pet {len(pets)}, dropped {len(pets) - len(pets_kept)} face/skin-like, kept {len(pets_kept)}")

    people_dropped = [p for p, s in zip(coco, score) if s >= SKIN_DROP] + [p for p, s in zip(pets, pet_score) if s >= SKIN_DROP]
    lfw_people = sorted(glob.glob(f"{ROOT}/lfw_home/lfw_home/lfw_funneled/*/"))
    lfw = [sorted(glob.glob(os.path.join(d, "*.jpg")))[0] for d in lfw_people if glob.glob(os.path.join(d, "*.jpg"))]
    lfw = [lfw[i] for i in sorted(np.random.default_rng(1).choice(len(lfw), size=min(3000, len(lfw)), replace=False))]
    people = people_dropped + lfw
    print(f"people: {len(people_dropped)} COCO/Pet face or skin photos + {len(lfw)} LFW faces")

    rng = np.random.default_rng(0)
    splits = {"train": [], "val": [], "test": []}
    for source, paths in [("dtd", dtd), ("coco_val2017", kept), ("oxford_pets", pets_kept), ("people", people)]:
        idx = rng.permutation(len(paths))
        a, b = int(0.8 * len(paths)), int(0.9 * len(paths))
        for name, part in [("train", idx[:a]), ("val", idx[a:b]), ("test", idx[b:])]:
            splits[name] += [(paths[i].replace("\\", "/"), source) for i in part]
    for name, rows in splits.items():
        df = pd.DataFrame(rows, columns=["image_path", "source"])
        df.to_csv(f"{OUT}/negatives_{name}.csv", index=False)
        print(f"negatives_{name}.csv: {len(df)} ({df.source.value_counts().to_dict()})")


if __name__ == "__main__":
    main()
