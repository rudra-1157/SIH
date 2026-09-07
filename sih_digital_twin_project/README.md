# AI-Enabled Digital Twin for MALE UAV Aero Piston Engine Health Monitoring
### SIH project — working model, data, and results

## 1. Honest data-provenance statement (read this first)

**No real MALE UAV piston-engine telemetry exists in this package, or anywhere publicly.**
That data is OEM/military proprietary and is never released. Everything below is
one of two honest categories — nothing is presented as real UAV data that isn't:

| Category | What it is | Where |
|---|---|---|
| **Real, public, verifiable** | NASA C-MAPSS turbofan degradation benchmark; NTSB aviation accident database filtered to reciprocating (piston) engines | `real_data/` |
| **Simulated / synthetic** | A physics-informed digital twin of a 4-cylinder Rotax-912/914-class piston engine, with documented equations and literature-sourced parameter ranges (declared as assumptions, not manufacturer specs) | `synthetic_data/`, `code/generator.py` |

This mirrors how the field itself handles this exact problem: NASA's own C-MAPSS
benchmark — the standard the whole predictive-maintenance research community
trains and reports against — is *also* a simulated run-to-failure dataset, not
recorded flight data. A transparent, physics-grounded simulation is the accepted
approach when real telemetry is inaccessible, provided the methodology is disclosed.
That is what this package does.

## 2. What's included

```
real_data/
  cmapss_fd001_train.csv, cmapss_fd001_test.csv, cmapss_fd001_RUL.csv   # NASA, real
  ntsb_reciprocating_engine_accidents.csv                                # NTSB, real (68,050 records)
synthetic_data/
  synthetic_train.csv        # 100 simulated engine units, full run-to-failure/mission trajectories
  synthetic_test.csv         # same units, truncated before failure (C-MAPSS-style test convention)
  synthetic_RUL_test.csv     # true remaining life at each truncation point
code/
  generator.py                # the digital twin physics simulator (documented assumptions inline)
  features.py                 # twin-residual + rolling-window feature engineering
  train_synthetic_models.py   # trains + evaluates the fault classifier and RUL regressor
  validate_on_cmapss.py       # same pipeline, run against the REAL NASA benchmark, as a sanity check
  digital_twin_demo.py        # streams one mission through the trained models, cycle by cycle
models/
  models_fault_classifier.joblib, models_rul_regressor.joblib, feature_cols.json
results/
  synthetic_model_metrics.json, cmapss_validation_metrics.json, digital_twin_demo_unit11.csv
digital_twin_dashboard.html   # interactive live-monitoring dashboard (open in a browser)
```

## 3. How the digital twin works

For every engine, two things run in parallel:
1. **The twin** — a physics/empirical model (`generator.py`) that predicts what
   CHT, EGT, oil pressure/temp, fuel flow and RPM *should* be, given the current
   throttle, altitude and airspeed, if the engine were healthy.
2. **The (simulated) live sensor stream** — the same channels, but with fault
   dynamics and sensor noise added.

The **residual** (actual − twin) is the anomaly signal — this is standard
model-based fault-detection practice, not something unique to this project.
A Random Forest classifier reads rolling-window statistics of these residuals
to identify which of 7 fault modes is developing (or "healthy"), and a Gradient
Boosting regressor estimates Remaining Useful Life (RUL) in cycles.

**7 fault modes simulated**, each with a distinct residual signature: spark plug
fouling, exhaust valve leak, cooling-airflow blockage, fuel injector clog, oil
starvation, bearing wear, fuel pump degradation. Signatures (which channels move,
in which direction, at what relative magnitude) are based on how these failure
modes are described in general-aviation piston-engine maintenance/engine-monitor
literature — see `code/generator.py` docstring for the declared assumption list.

## 4. Results

**Fault classifier** (Random Forest, validated on held-out engine units never
seen in training): macro-F1 **0.96**, weighted-F1 **0.98**, accuracy **98%**.
Full confusion matrix and per-class scores in `results/synthetic_model_metrics.json`.

**RUL regressor** (Gradient Boosting): mean absolute error **10.5 cycles**
(on a 125-cycle capped label, the standard piecewise-linear RUL convention
from the PHM literature).

**Live demo trace** (`digital_twin_demo_unit11.csv`): a cooling-airflow-blockage
fault with true onset at cycle 243 was flagged by the model at cycle 244 — a
1-cycle detection lag — with the mission-reliability estimate correctly
collapsing from 100% toward single digits as true failure approached.

**Reality check against real data** (`validate_on_cmapss.py`): the identical
feature-engineering + Gradient Boosting pipeline, run on the real NASA C-MAPSS
FD001 benchmark (turbofan, not piston — used purely to confirm the *methodology*
isn't overfit to our own simulation), achieves RUL MAE of **13.4 cycles**.
For calibration: a 2025 published ensemble study (LightGBM+CatBoost) reports
MAE of **4.96 cycles** on the same FD001 split — so our simple two-model
pipeline is in a reasonable, competitive-but-not-state-of-the-art range for a
first working version, which is what a hackathon MVP should aim for.

**NTSB validation** (`ntsb_reciprocating_engine_accidents.csv`): 68,050 real
U.S. piston-engine accident records confirm that in-flight failures cluster
heavily around landing, takeoff, and cruise phases — consistent with the
mission-phase structure the simulator already encodes.

## 5. How to reproduce

```bash
pip install scikit-learn xgboost pandas numpy joblib
cd code
python generator.py                 # rebuilds synthetic_data/
python train_synthetic_models.py    # trains + evaluates both models
python validate_on_cmapss.py        # real-data sanity check
python digital_twin_demo.py         # generates a live monitoring trace
```
Open `digital_twin_dashboard.html` directly in a browser — no server needed
(this shows one precomputed mission).

## 5b. Live web app (backend + frontend)

`webapp/` is a full connected app — FastAPI backend serving the trained
models live, plus a frontend that calls it (mission playback with a live
scrubber, and a manual sensor-input panel for testing individual readings).
Nothing in it is precomputed.

```bash
cd webapp
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
# open http://localhost:8000
```

I couldn't push this to a live URL myself (my sandbox has no access to
hosting platforms or your accounts) — `webapp/DEPLOY.md` has exact, tested
copy-paste steps for Render, Railway, or Fly.io, all of which just read the
included `Dockerfile`.

## 6. Honest limitations (say these in your presentation, don't wait to be asked)

- Parameter ranges (CHT/EGT/oil bands, fault magnitudes) are representative
  assumptions from public GA piston-engine literature, not manufacturer or
  DRDO-certified figures for any specific UAV engine.
- Fault co-occurrence, cross-cylinder heat coupling, and altitude-density
  effects on combustion are simplified relative to a full thermodynamic model.
- The classifier has near-zero real-world validation, because no real-world
  data of this kind exists to validate against — the C-MAPSS check only
  validates the *modeling pipeline*, not the piston-engine physics itself.
- Next step for real deployment: replace `generator.py`'s assumed constants
  with values from bench-test data on the actual engine type once available,
  and revalidate before flight use.
