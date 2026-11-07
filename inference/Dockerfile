# SkinSense inference service (FastAPI + MobileNetV3 student + Whisper Urdu ASR) on ONNX Runtime, CPU-only, no PyTorch.
# Build from the repo root's deploy/docker-compose.yml, or: docker build -t skinsense-inference inference/
# Model weights are Git LFS files: run `git lfs pull` before building, or startup fails on an LFS pointer.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY server.py quality.py whisper_onnx.py ./
COPY models/ ./models/

RUN useradd --system --uid 10001 --home /app skinsense \
    && mkdir -p /data/heatmaps \
    && chown -R skinsense /data
USER skinsense

ENV INFERENCE_PORT=5001 \
    HEATMAP_DIR=/data/heatmaps \
    INFERENCE_THREADS=4
EXPOSE 5001

# The models load in a few seconds; the start period leaves room for a slow disk.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import json,urllib.request,sys; d=json.load(urllib.request.urlopen('http://localhost:5001/health', timeout=8)); sys.exit(0 if d.get('model_loaded') else 1)"

# One worker on purpose: each worker loads its own copy of the models.
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${INFERENCE_PORT} --workers 1 --timeout-keep-alive 75"]
