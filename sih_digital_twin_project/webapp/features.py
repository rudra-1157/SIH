"""
Digital-twin residual feature engineering.
Core idea: the twin predicts expected healthy-state values in real time; the
residual (observed - twin) is the primary anomaly signal, same as a real
model-based fault-detection system would use (this is standard practice in
digital-twin / model-based diagnostics, not unique to this project).
"""
import pandas as pd

RESIDUAL_PAIRS = [
    ("rpm", "rpm_twin"), ("oil_pressure_kpa", "oil_pressure_twin"),
    ("oil_temp_c", "oil_temp_twin"), ("fuel_flow_lph", "fuel_flow_twin"),
] + [(f"cht_{i}_c", f"cht_{i}_twin") for i in range(1, 5)] \
  + [(f"egt_{i}_c", f"egt_{i}_twin") for i in range(1, 5)]

ROLL_WINDOW = 5


def add_features(df):
    df = df.sort_values(["unit_number", "cycle"]).copy()
    resid_cols = []
    for obs, twin in RESIDUAL_PAIRS:
        rname = f"resid_{obs}"
        df[rname] = df[obs] - df[twin]
        resid_cols.append(rname)

    df["vibration_rms_g_resid"] = df["vibration_rms_g"] - 0.08  # deviation from nominal baseline
    resid_cols.append("vibration_rms_g_resid")

    grp = df.groupby("unit_number")
    roll_feats = []
    for c in resid_cols:
        rmean = grp[c].transform(lambda s: s.rolling(ROLL_WINDOW, min_periods=1).mean())
        rstd = grp[c].transform(lambda s: s.rolling(ROLL_WINDOW, min_periods=1).std().fillna(0))
        df[f"{c}_rollmean"] = rmean
        df[f"{c}_rollstd"] = rstd
        roll_feats += [f"{c}_rollmean", f"{c}_rollstd"]

    feature_cols = resid_cols + roll_feats + ["throttle_pct", "mission_altitude_m", "mission_airspeed_kmh"]
    return df, feature_cols
