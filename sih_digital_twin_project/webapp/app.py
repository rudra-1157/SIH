from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import twin_model as tm
import database as db

app = FastAPI(title="MALE UAV Piston Engine Digital Twin API")
db.init_db()


class SimulateRequest(BaseModel):
    fault_name: Optional[str] = None   # one of tm.CLASS_NAMES values, or None = random
    seed: Optional[int] = None
    n_cycles: Optional[int] = None


class PredictRequest(BaseModel):
    reading: dict
    history: Optional[list] = None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/fault_classes")
def fault_classes():
    return tm.CLASS_NAMES


@app.post("/api/simulate")
def simulate(req: SimulateRequest):
    fault_id = None
    if req.fault_name is not None:
        name_to_id = {v: k for k, v in tm.CLASS_NAMES.items()}
        if req.fault_name not in name_to_id:
            raise HTTPException(400, f"Unknown fault_name. Valid: {list(name_to_id)}")
        fault_id = name_to_id[req.fault_name]
    try:
        result = tm.run_new_mission(fault_id=fault_id, seed=req.seed, n_cycles=req.n_cycles)
        run_id = db.log_simulate(result, req.model_dump())
        result["run_id"] = run_id
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/predict")
def predict(req: PredictRequest):
    try:
        result = tm.score_live_reading(req.reading, req.history)
        run_id = db.log_predict(result, req.reading)
        result["run_id"] = run_id
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/history")
def history(limit: int = 50):
    return db.get_history(limit)


@app.get("/api/history/{run_id}")
def history_detail(run_id: int):
    payload = db.get_run_payload(run_id)
    if payload is None:
        raise HTTPException(404, "run not found")
    return payload


# --- serve the frontend ---
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
