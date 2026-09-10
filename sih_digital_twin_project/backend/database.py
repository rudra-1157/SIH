"""
Lightweight persistence (SQLite, stdlib only -- no extra dependency).
Every /api/simulate and /api/predict call is logged here, so the system has
an actual maintenance-log/history, not just stateless scoring.
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

DB_PATH = "digital_twin.db"


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                mode TEXT NOT NULL,                 -- 'simulate' or 'predict'
                fault_name TEXT,                    -- ground-truth fault (simulate) or null (predict)
                predicted_fault_name TEXT NOT NULL,
                fault_confidence REAL,
                predicted_rul REAL,
                mission_reliability_pct REAL,
                n_cycles INTEGER,
                payload_json TEXT NOT NULL           -- full request+response, for reproducibility
            )
        """)
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def log_simulate(result: dict, request_params: dict) -> int:
    last = result["trace"][-1]
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO runs (created_at, mode, fault_name, predicted_fault_name, "
            "fault_confidence, predicted_rul, mission_reliability_pct, n_cycles, payload_json) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), "simulate", result["fault_name_simulated"],
             last["predicted_fault_name"], last["fault_confidence"], last["predicted_RUL"],
             last["mission_reliability_pct"], result["n_cycles"],
             json.dumps({"request": request_params, "final_state": last}))
        )
        conn.commit()
        return cur.lastrowid


def log_predict(result: dict, reading: dict) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO runs (created_at, mode, fault_name, predicted_fault_name, "
            "fault_confidence, predicted_rul, mission_reliability_pct, n_cycles, payload_json) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), "predict", None,
             result["predicted_fault_name"], result["fault_confidence"], result["predicted_RUL"],
             result["mission_reliability_pct"], None,
             json.dumps({"reading": reading, "result": result}))
        )
        conn.commit()
        return cur.lastrowid


def get_history(limit: int = 50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, created_at, mode, fault_name, predicted_fault_name, fault_confidence, "
            "predicted_rul, mission_reliability_pct, n_cycles FROM runs "
            "ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_run_payload(run_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT payload_json FROM runs WHERE id = ?", (run_id,)).fetchone()
        return json.loads(row["payload_json"]) if row else None
