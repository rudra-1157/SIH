# Digital Twin Web App (backend + frontend)

A connected full-stack app wrapping the trained models from `../code/` and
`../models/` in the main project package:

- **Backend** (`app.py`, FastAPI): `POST /api/simulate` runs a brand-new
  physics-simulated mission live and scores every cycle through the trained
  fault classifier + RUL regressor. `POST /api/predict` scores a single
  live sensor reading against the twin in real time. Nothing is precomputed —
  every response is generated on request.
- **Frontend** (`static/`): a dashboard that calls those endpoints — mission
  playback with a scrubber, live gauges, and a manual sensor-input panel for
  testing individual readings (defaults to a twin-consistent healthy baseline;
  see the caption in the UI for how to perturb it into a fault).

## Run it

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```
Open http://localhost:8000

See `DEPLOY.md` for how to put this on a real URL (Render/Railway/Fly.io) —
I can't deploy it myself from this sandbox, so those are exact, verified
copy-paste steps rather than something already done for you.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{"status":"ok"}` |
| GET | `/api/fault_classes` | — | class-id → name mapping |
| POST | `/api/simulate` | `{fault_name?, seed?, n_cycles?}` | full mission trace, cycle-by-cycle predictions, `run_id` |
| POST | `/api/predict` | `{reading: {...}, history?: [...]}` | fault class, confidence, RUL, reliability, `run_id` |
| GET | `/api/history?limit=50` | — | past runs (most recent first) from the database |
| GET | `/api/history/{run_id}` | — | full stored payload for one run |

`fault_name` values: `healthy`, `spark_plug_fouling`, `exhaust_valve_leak`,
`cooling_airflow_blockage`, `fuel_injector_clog`, `oil_starvation`,
`bearing_wear`, `fuel_pump_degradation`.

## Database

`database.py` uses SQLite (Python's stdlib `sqlite3`, no extra dependency).
Every `/api/simulate` and `/api/predict` call is logged to `digital_twin.db`
(created automatically on first run, in the working directory) with a
timestamp, prediction, and the full request/response payload. This is real
persistence, not in-memory state — verified by restarting the server and
confirming `/api/history` still returns prior runs. The frontend's "Mission
History" panel reads from this table live.

## Testing the whole stack yourself

```bash
# 1. retrain the models from the dataset (proves training works end-to-end)
cd ../code && python train_synthetic_models.py
cp models_fault_classifier.joblib models_rul_regressor.joblib feature_cols.json ../webapp/

# 2. start the backend (loads those freshly-trained models)
cd ../webapp && uvicorn app:app --host 0.0.0.0 --port 8000

# 3. in another terminal -- exercise prediction + database logging
curl -X POST localhost:8000/api/simulate -H "Content-Type: application/json" -d '{"fault_name":"bearing_wear"}'
curl localhost:8000/api/history

# 4. restart the server and confirm history persisted
#    (Ctrl+C, then re-run the uvicorn command, then curl /api/history again)
```
