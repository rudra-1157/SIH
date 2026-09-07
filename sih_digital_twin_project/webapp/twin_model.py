"""
Wraps generator.py (the physics twin) and the trained models so the API can
(a) run a brand-new simulated mission on demand, and (b) score a single live
sensor reading against the twin in real time.
"""
import json
import joblib
import numpy as np
import pandas as pd

import generator as gen
from features import add_features

_clf = joblib.load("models_fault_classifier.joblib")
_reg = joblib.load("models_rul_regressor.joblib")
_feature_cols = json.load(open("feature_cols.json"))

CLASS_NAMES = {0: "healthy", 1: "spark_plug_fouling", 2: "exhaust_valve_leak",
               3: "cooling_airflow_blockage", 4: "fuel_injector_clog",
               5: "oil_starvation", 6: "bearing_wear", 7: "fuel_pump_degradation"}

FAULT_IDS = list(range(1, 8))


def run_new_mission(fault_id: int | None = None, seed: int | None = None, n_cycles: int | None = None):
    """Simulates one full mission (random fault type if not specified) and runs
    it through the trained models cycle-by-cycle, exactly like a live twin would."""
    rng = np.random.default_rng(seed)
    gen.RNG = rng
    n_cycles = n_cycles or int(rng.integers(250, 600))

    if fault_id is None:
        fault_id = int(rng.choice([0] + FAULT_IDS, p=[0.15] + [0.85 / 7] * 7))

    if fault_id == 0:
        unit_df = gen.simulate_unit(1, 0, n_cycles, 0, 0)
    else:
        onset_frac = float(rng.uniform(0.15, 0.55))
        degrade_len = int(rng.integers(40, 160))
        unit_df = gen.simulate_unit(1, fault_id, n_cycles, onset_frac, degrade_len)

    df, _ = add_features(unit_df)
    probs = _clf.predict_proba(df[_feature_cols])
    classes = _clf.classes_
    pred_class = classes[probs.argmax(axis=1)]
    conf = probs.max(axis=1)
    rul_pred = np.clip(_reg.predict(df[_feature_cols]), 0, 125)

    reliability = np.where(pred_class == 0, 100.0, np.clip(rul_pred / 125 * 100, 0, 100))
    prob_dicts = [{CLASS_NAMES[c]: round(float(p), 3) for c, p in zip(classes, row)} for row in probs]

    out = pd.DataFrame({
        "cycle": df["cycle"], "true_fault_class": df["fault_class"],
        "true_fault_name": df["fault_name"], "true_RUL": df["RUL"],
        "mission_altitude_m": df["mission_altitude_m"], "mission_airspeed_kmh": df["mission_airspeed_kmh"],
        "throttle_pct": df["throttle_pct"], "rpm": df["rpm"],
        "oil_pressure_kpa": df["oil_pressure_kpa"], "oil_temp_c": df["oil_temp_c"],
        "fuel_flow_lph": df["fuel_flow_lph"], "vibration_rms_g": df["vibration_rms_g"],
        "cht_1_c": df["cht_1_c"], "cht_1_twin": df["cht_1_twin"],
        "cht_2_c": df["cht_2_c"], "cht_2_twin": df["cht_2_twin"],
        "cht_3_c": df["cht_3_c"], "cht_3_twin": df["cht_3_twin"],
        "cht_4_c": df["cht_4_c"], "cht_4_twin": df["cht_4_twin"],
        "egt_1_c": df["egt_1_c"], "egt_1_twin": df["egt_1_twin"],
        "egt_2_c": df["egt_2_c"], "egt_2_twin": df["egt_2_twin"],
        "egt_3_c": df["egt_3_c"], "egt_3_twin": df["egt_3_twin"],
        "egt_4_c": df["egt_4_c"], "egt_4_twin": df["egt_4_twin"],
        "oil_temp_c": df["oil_temp_c"], "oil_temp_twin": df["oil_temp_twin"],
        "oil_pressure_kpa": df["oil_pressure_kpa"], "oil_pressure_twin": df["oil_pressure_twin"],
        "fuel_flow_lph": df["fuel_flow_lph"], "fuel_flow_twin": df["fuel_flow_twin"],
        "predicted_fault_class": pred_class.astype(int),
        "predicted_fault_name": [CLASS_NAMES[c] for c in pred_class],
        "fault_confidence": conf.round(3),
        "predicted_RUL": rul_pred.round(1),
        "mission_reliability_pct": np.round(reliability, 1),
        "class_probabilities": prob_dicts,
    })
    return {
        "fault_id_simulated": fault_id,
        "fault_name_simulated": CLASS_NAMES[fault_id],
        "n_cycles": len(out),
        "trace": out.to_dict(orient="records"),
    }


def score_live_reading(reading: dict, history: list[dict] | None = None):
    """Scores a single incoming sensor reading. `reading` must contain the raw
    channels (throttle_pct, mission_altitude_m, mission_airspeed_kmh, rpm,
    oil_pressure_kpa, oil_temp_c, fuel_flow_lph, vibration_rms_g, cht_1..4_c,
    egt_1..4_c). The twin's expected values are computed from throttle/altitude/
    airspeed using the same physics as generator.py, then residual features are
    built. `history` (optional list of prior readings, oldest first) is used to
    compute the rolling window the model was trained on; without it, single-point
    rolling stats fall back to the point itself (std=0).
    """
    rows = (history or []) + [reading]
    df_raw = pd.DataFrame(rows)
    df_raw["unit_number"] = 1
    df_raw["cycle"] = range(1, len(df_raw) + 1)

    throttle = df_raw["throttle_pct"] / 100
    alt_m = df_raw["mission_altitude_m"]
    density_ratio = np.clip(1 - alt_m / 44330, 0.55, 1.0) ** 4.256
    power_frac = throttle * density_ratio
    cooling = 0.4 + 0.6 * (df_raw["mission_airspeed_kmh"] / 130)

    df_raw["rpm_twin"] = gen.RPM_IDLE + throttle * (gen.RPM_MAX - gen.RPM_IDLE)
    cht_base = gen.CHT_AMBIENT_BASE + (gen.CHT_CRUISE_NOM - gen.CHT_AMBIENT_BASE) * power_frac / cooling
    for i in range(1, 5):
        df_raw[f"cht_{i}_twin"] = cht_base
        df_raw[f"egt_{i}_twin"] = gen.EGT_CRUISE_NOM * (0.6 + 0.4 * power_frac)
    df_raw["oil_pressure_twin"] = gen.OIL_P_NOM * (0.85 + 0.15 * (df_raw["rpm_twin"] / gen.RPM_CRUISE))
    df_raw["oil_temp_twin"] = gen.OIL_T_NOM * (0.8 + 0.2 * power_frac)
    df_raw["fuel_flow_twin"] = gen.FUEL_FLOW_NOM * (0.4 + 0.6 * power_frac)

    df, _ = add_features(df_raw)
    last = df.iloc[[-1]]
    probs = _clf.predict_proba(last[_feature_cols])[0]
    pred_class = int(_clf.classes_[probs.argmax()])
    rul_pred = float(np.clip(_reg.predict(last[_feature_cols])[0], 0, 125))
    reliability = 100.0 if pred_class == 0 else float(np.clip(rul_pred / 125 * 100, 0, 100))

    return {
        "predicted_fault_class": pred_class,
        "predicted_fault_name": CLASS_NAMES[pred_class],
        "fault_confidence": round(float(probs.max()), 3),
        "predicted_RUL": round(rul_pred, 1),
        "mission_reliability_pct": round(reliability, 1),
        "class_probabilities": {CLASS_NAMES[c]: round(float(p), 3) for c, p in zip(_clf.classes_, probs)},
    }
