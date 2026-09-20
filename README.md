# FYP
Hub for all resources and work related to SkinSense - an application of AI Optimization for Low Resource Devices


# SkinSense

An on-device dermatological screening system targeting low-income rural areas with poor connectivity.

## Target Conditions
- Vitiligo
- Melasma
- Psoriasis
- Eczema
- Tinea
- Contact Dermatitis
- Seborrheic Dermatitis

## Stack
- PyTorch (training)
- MobileNetV3 (CNN backbone)
- TensorFlow Lite (mobile deployment)
- Flutter (Android/iOS app)

## Datasets
- DermaCon-IN
- SCIN
- SkinDisNet

# Brain-Inspired Architecture Research (experimental)

A separate research track exploring whether brain-efficiency principles
(sparse activation, predictive coding, neuromodulation) can match SkinSense's
production model at lower compute — SkinSense serves as the applied testbed.
Not part of the shipped app; lives in `notebooks/train_model_b.ipynb`, with
the full research narrative in `Brain-Inspired-Architecture-Research.md`.

Nine configurations, trained and compared against each other and against a
plain-CNN control (`baseline`) on the same SkinSense dataset/split:

| Model | Core mechanism | Features |
|---|---|---|
| `baseline` | Plain conv stack | Control arm — no prediction, gating, or sparsity |
| `model_b` | Surprise-only propagation | Stacked `PredictiveLayer`s: each layer predicts its own input, only the gated prediction *error* propagates onward |
| `fix_a` | Model B, reconstruction loss removed | Tests whether the reconstruction term was fighting the classification objective |
| `fix_b` | Model B, deeper predictor | 2-layer predictor (`PredictiveLayerBetterPredictor`) + 5x higher sparsity weight |
| `model_1` | + global dopamine | One learned scalar per image ("how wrong does the network feel overall") modulates every layer's gate |
| `model_2a` | + serotonin | Running-variance estimate of dopamine dampens how hard it can swing gates during volatile training |
| `model_2b` | + acetylcholine, norepinephrine | Additive, globally-driven salience floor rescues layers that have gone quiet — the fix for the "Dead Layer Problem"; hypothesized sweet spot |
| `model_2c` | + cortisol, endorphins | Tests whether modulation keeps helping past 2b or starts adding noise |
| `model_a` | Full brain architecture | `ThalamicGate` (context-filtered input), `KWinnersTakeAll` (local, not global, sparsity), `HippocampalMemory` (64-slot attention-queried memory bank), GRU-updated persistent context (working memory / top-down feedback) |

Every neuromodulator above is a small learned head reading pooled features —
a backprop-trainable approximation of the biological signal, not a literal
per-synapse Hebbian update. Status as of the last run: Model B beat baseline
(+4.76pp test acc) but never achieved the intended gate-sparsification;
Fix A/B, Models 1 through 2c, and Model A are implemented and ready to train
but not yet executed against real results.
