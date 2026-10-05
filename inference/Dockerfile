# SkinSense inference service (FastAPI + MobileNetV3 student + Whisper Urdu ASR), CPU-only.
# Build from the repo root's deploy/docker-compose.yml, or: docker build -t skinsense-inference inference/
# Model weights are Git LFS files: run `git lfs pull` before building, or startup fails on an LFS pointer.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU wheels only: the CUDA build of torch adds ~4 GB to the image and production inference runs on CPU.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY server.py quality.py ./
COPY models/ ./models/

RUN useradd --system --uid 10001 --home /app skinsense \
    && mkdir -p /data/heatmaps \
    && chown -R skinsense /data
USER skinsense

ENV INFERENCE_PORT=5001 \
    HEATMAP_DIR=/data/heatmaps \
    OMP_NUM_THREADS=4
EXPOSE 5001

# Whisper + the student take ~30-60 s to load on CPU; the start period covers that.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python -c "import json,urllib.request,sys; d=json.load(urllib.request.urlopen('http://localhost:5001/health', timeout=8)); sys.exit(0 if d.get('model_loaded') else 1)"

# One worker on purpose: each worker loads its own copy of the models (~2.8 GB RAM).
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${INFERENCE_PORT} --workers 1 --timeout-keep-alive 75"]
