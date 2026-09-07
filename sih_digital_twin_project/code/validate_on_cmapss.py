"""
Methodology sanity-check on REAL data: NASA C-MAPSS FD001 (turbofan).
This is not our piston-engine model — it's a different engine type entirely.
Its only purpose here is to confirm that the RUL-prediction *pipeline*
(rolling-window features + gradient boosting) is sound on a real,
independently-verified run-to-failure dataset before trusting it on the
piston-engine simulation, where no real ground truth exists to check against.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

RUL_CAP = 125
SENSOR_COLS = [f"sensor_{i}" for i in range(1, 22)]

train = pd.read_csv("data/real/cmapss_fd001_train.csv")
test = pd.read_csv("data/real/cmapss_fd001_test.csv")
rul_test = pd.read_csv("data/real/cmapss_fd001_RUL.csv").set_index("unit_number")["RUL"]

# piecewise-linear RUL label (same convention used for the synthetic dataset)
max_cycle = train.groupby("unit_number")["cycle"].transform("max")
train["RUL"] = np.minimum(max_cycle - train["cycle"], RUL_CAP)

# drop sensors with ~zero variance in this sub-dataset (known C-MAPSS quirk for FD001)
usable = [c for c in SENSOR_COLS if train[c].std() > 1e-6]

def add_rolling(df, cols, window=5):
    g = df.groupby("unit_number")
    for c in cols:
        df[f"{c}_rollmean"] = g[c].transform(lambda s: s.rolling(window, min_periods=1).mean())
        df[f"{c}_rollstd"] = g[c].transform(lambda s: s.rolling(window, min_periods=1).std().fillna(0))
    return df

train = add_rolling(train, usable)
test = add_rolling(test, usable)
feat_cols = usable + [f"{c}_rollmean" for c in usable] + [f"{c}_rollstd" for c in usable]

reg = GradientBoostingRegressor(n_estimators=300, max_depth=4, learning_rate=0.05, random_state=42)
reg.fit(train[feat_cols], train["RUL"])

last_rows = test.sort_values("cycle").groupby("unit_number").tail(1).set_index("unit_number")
pred = reg.predict(last_rows[feat_cols])
true = rul_test.loc[last_rows.index]

mae = mean_absolute_error(true, np.minimum(pred, RUL_CAP))
print(f"NASA C-MAPSS FD001 (real data) RUL MAE at final observed cycle: {mae:.1f} cycles "
      f"(cap={RUL_CAP}); published literature baselines for comparable simple pipelines "
      f"on FD001 are typically in the ~15-25 cycle MAE range.")

with open("cmapss_validation_metrics.json", "w") as f:
    import json
    json.dump({"real_dataset": "NASA C-MAPSS FD001", "rul_mae_cycles": mae, "rul_cap": RUL_CAP,
               "n_test_units": len(true)}, f, indent=2)
