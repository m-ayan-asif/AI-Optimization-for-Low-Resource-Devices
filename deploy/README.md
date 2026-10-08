# Deploying SkinSense (PC / server)

One Docker Compose stack runs everything the PC side needs:

| Service | Image | What it does | Memory |
|---|---|---|---|
| `web` | Caddy 2 + the Vite build of `client/` | HTTPS, serves the PWA (incl. on-device model files), proxies `/api/*` and `/heatmaps/*` | ~15 MB |
| `api` | Node 20 (`server/`) | Express API, auth, screenings, telemetry | ~20 MB |
| `inference` | Python 3.11, CPU PyTorch (`inference/`) | MobileNetV3 student (320 px) + Grad-CAM, Whisper-small Urdu ASR | ~1.6 GB peak |
| `db` | Postgres 16 | Data; migrations in `server/migrations/` applied on first boot | ~60 MB |

Only Caddy is published (ports 80/443). The API, inference service and database are reachable only on the
internal Compose network. Patient uploads (`/data/uploads`) are not exposed over HTTP at all.

## Requirements

- Docker Engine 24+ with Compose v2 (Docker Desktop on Windows/macOS is fine).
- **RAM: 3 GB free minimum, 4 GB+ recommended.** Measured in the container (Linux, CPU-only PyTorch) after an image
  prediction with Grad-CAM and a Whisper transcription: inference peaked at 1.57 GB (cgroup `memory.peak`) and
  settled at ~1.25 GB; the other three containers together use ~100 MB. Running natively on Windows with the CUDA
  build of PyTorch, the same stack peaks at ~2.85 GB. Inference is capped at 4 GB by `INFERENCE_MEM_LIMIT`.
- Disk: ~6 GB for images (the inference image is ~5.3 GB, mostly PyTorch CPU + the 0.9 GB Whisper weights).
- CPU: 4+ cores recommended. Measured in the container on a 12-thread desktop CPU: a 320 px prediction including Grad-CAM ~200-300 ms server time, a 5 s voice note a few seconds.
- Git LFS, because model weights are LFS files.

## First deployment

```bash
git clone https://github.com/m-ayan-asif/AI-Optimization-for-Low-Resource-Devices.git skinsense
cd skinsense
git lfs install && git lfs pull          # real weights, not LFS pointers (the service refuses to start on a pointer)

cd deploy
cp .env.example .env
# edit .env: DOMAIN, ACME_EMAIL, and generate the secrets:
#   POSTGRES_PASSWORD=$(openssl rand -hex 24)
#   JWT_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
docker compose ps                         # wait until inference shows (healthy), ~1-2 min on first start
```

Open `https://<DOMAIN>/`, register an account and run a screening. The API refuses to start in production if
`JWT_SECRET` is missing, shorter than 32 characters or still a placeholder.

**Clinician accounts:** registration takes a `role` (`patient` or `clinician`). There is no separate admin
bootstrap step.

## HTTPS: pick one

Phones need HTTPS: service workers (offline PWA) and the microphone only work in a secure context.

1. **Real domain (recommended for production).** Point an A/AAAA record at the machine, open ports 80 and 443,
   set `DOMAIN=skinsense.example.org` and `ACME_EMAIL`. Caddy gets and renews a Let's Encrypt certificate
   automatically.
2. **No domain, phones on the internet: a tunnel.** Cloudflare Tunnel (`cloudflared tunnel --url https://localhost`
   with *No TLS Verify*, or a named tunnel on your own Cloudflare domain) or Tailscale Funnel/Serve
   (`tailscale serve https / https+insecure://localhost:443`) give a publicly trusted HTTPS URL without opening
   ports. Set `DOMAIN` to the hostname the tunnel uses, or keep `localhost` and let the tunnel terminate TLS.
3. **LAN only (clinic Wi-Fi, no internet).** Set `DOMAIN` to the server's LAN IP (e.g. `192.168.1.20`). Caddy
   issues a certificate from its own internal CA. Every phone must trust that CA once, or the browser refuses
   the service worker:
   ```bash
   docker compose cp web:/data/caddy/pki/authorities/local/root.crt ./skinsense-root.crt
   ```
   Install `skinsense-root.crt` on each phone (Android: Settings → Security → Encryption & credentials →
   Install a certificate → CA certificate; iOS: open the file, install the profile, then enable full trust under
   Settings → General → About → Certificate Trust Settings). Give the server a static IP or DHCP reservation.

## Installing on a phone (PWA)

1. Open `https://<DOMAIN>` in Chrome (Android) or Safari (iOS) and sign in.
2. Install it: Chrome menu → *Install app* / *Add to Home screen*; Safari share sheet → *Add to Home Screen*.
3. Run one screening while online. That caches the app shell (~15 MB including the ONNX Runtime) and the skin model (13 MB). The first voice note downloads Whisper once (330 MB), so do it on Wi-Fi.
4. From then on, screening (photo + voice) works with no connection. Results are stored on the phone and upload to the account automatically when it is back online. A banner shows how many are waiting.

- **Where it runs:** on phones the screening page defaults to *This phone*, on desktops to *Server*; users can switch. If the server's inference is down, the app falls back to the phone.
- **Phone requirements:** a recent Chrome/Edge/Samsung Internet or Safari 16.4+, and enough free memory for Whisper (about 1 GB while transcribing). If Whisper fails on a low-memory phone, the audio is still uploaded and the server transcribes it.
- **Shipping a new model:** put it in a new folder (e.g. `client/public/models/skin-v3/`), point `client/src/ondevice/config.js` at it and rebuild. Never overwrite files in an existing model folder: `/models/*` is cached as immutable.

## Configuration (`deploy/.env`)

| Variable | Default | Notes |
|---|---|---|
| `DOMAIN` | `localhost` | Site address; decides the certificate type (above). Also sets the API's allowed CORS origin. |
| `ACME_EMAIL` | `admin@example.com` | Let's Encrypt account email (expiry notices). |
| `POSTGRES_PASSWORD` | required | Used by both `db` and `api`. Changing it after the first boot needs an `ALTER USER` in Postgres. |
| `JWT_SECRET` | required | ≥32 random characters. Rotating it logs everyone out. |
| `JWT_EXPIRES_IN` | `30m` | Session length. |
| `MODEL_PATH` | `./models/student_clean_res320_s2_notlesion_v2.pth` | Student checkpoint inside the inference image (8 outputs: 7 diseases + "not a skin lesion"). |
| `IMG_SIZE` | `320` | Must match the checkpoint (320 for the clean-split production student, 224 for the old one). |
| `ASR_MODEL_PATH` | `./models/asr/whisper-small-urdu-ours` | Only this Whisper is copied into the image (see `inference/.dockerignore`). |
| `INFERENCE_THREADS` | `4` | PyTorch/OpenMP threads. Set to the number of physical cores you can spare. |
| `INFERENCE_MEM_LIMIT` | `4g` | Hard cap on the inference container. Do not go below ~2.5g (1.6 GB measured peak plus headroom for long voice notes). |
| `INFERENCE_TIMEOUT_MS` | `60000` | API → inference timeout. CPU Whisper on a long voice note can take tens of seconds. |

## Operating it

```bash
docker compose logs -f inference          # or api / web / db
docker compose ps
docker stats --no-stream                  # memory per container
docker compose restart api
```

**Updating** (new code or new model weights):

```bash
git pull && git lfs pull
docker compose up -d --build
```

Migrations in `server/migrations/` only run automatically on an **empty** database volume. For a new migration on
an existing deployment, apply it by hand:

```bash
docker compose exec -T db psql -U skinsense -d skinsense < ../server/migrations/005_whatever.sql
```

**Backups:**

```bash
docker compose exec -T db pg_dump -U skinsense -d skinsense -Fc > skinsense_$(date +%F).dump
# restore into a fresh stack:
docker compose exec -T db pg_restore -U skinsense -d skinsense --clean < skinsense_YYYY-MM-DD.dump
```

Uploaded images and voice notes live in the `skinsense_uploads` volume and heatmaps in `skinsense_heatmaps`.
Back them up with e.g.
`docker run --rm -v skinsense_uploads:/v -v "$PWD":/b alpine tar czf /b/uploads.tgz -C /v .`.

**Stopping:** `docker compose down` keeps all data. `docker compose down -v` **deletes the database, uploads and
certificates.**

## Notes

- The inference service runs one uvicorn worker on purpose: each worker loads its own copy of the models.
- If the inference service is down, the API falls back to mock predictions whose `model_version` contains
  `mock`. Check `docker compose ps` / the inference logs if results look generic.
- `/heatmaps/<uuid>.png` is served without authentication, as in development (unguessable UUID names). Patient
  photos are never served publicly.
- GPU inference is not set up in this stack: the production target is CPU, and a GPU build of PyTorch would add
  ~4 GB to the image.
