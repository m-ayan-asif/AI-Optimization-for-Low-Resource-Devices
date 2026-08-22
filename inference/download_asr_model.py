"""
One-time script to download kingabzpro/whisper-large-v3-turbo-urdu
into the local inference/models/asr/whisper-urdu directory so the
inference service can run fully offline afterwards.

Run once (with internet):
    cd inference
    python download_asr_model.py
"""

import os
from huggingface_hub import snapshot_download

MODEL_ID = "kingabzpro/whisper-large-v3-turbo-urdu"
LOCAL_DIR = os.path.join(os.path.dirname(__file__), "models", "asr", "whisper-urdu")

print(f"Downloading {MODEL_ID}")
print(f"Destination: {LOCAL_DIR}")
print("This may take several minutes (~1.5 GB)...\n")

snapshot_download(repo_id=MODEL_ID, local_dir=LOCAL_DIR)

print(f"\nDone. Model saved to {LOCAL_DIR}")
print("The inference service will load it offline via ASR_MODEL_PATH.")
