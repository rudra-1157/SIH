import json
import joblib
import pandas as pd
from features import add_features, RESIDUAL_PAIRS

clf = joblib.load("models_fault_classifier.joblib")
reg = joblib.load("models_rul_regressor.joblib")
feature_cols = json.load(open("feature_cols.json"))

full = pd.read_csv("data/synthetic_train.csv")

# pick one illustrative faulty unit (cooling airflow blockage - clear, gradual, relatable fault)
candidates = full[full["fault_name"] == "cooling_airflow_blockage"]["unit_number"].unique()
unit_id = int(candidates[0])
unit_df = full[full["unit_number"] == unit_id].reset_index(drop=True)

df, _ = add_features(unit_df)
probs = clf.predict_proba(df[feature_cols])
classes = clf.classes_
pred_class = classes[probs.argmax(axis=1)]
fault_conf = probs.max(axis=1)
rul_pred = reg.predict(df[feature_cols])

class_names = {0: "healthy", 1: "spark_plug_fouling", 2: "exhaust_valve_leak",
               3: "cooling_airflow_blockage", 4: "fuel_injector_clog",
               5: "oil_starvation", 6: "bearing_wear", 7: "fuel_pump_degradation"}

out = pd.DataFrame({
    "cycle": df["cycle"],
    "true_fault_class": df["fault_class"],
    "true_fault_name": df["fault_name"],
    "true_RUL": df["RUL"],
    "cht_1_c": df["cht_1_c"], "cht_1_twin": df["cht_1_twin"],
    "oil_temp_c": df["oil_temp_c"], "oil_temp_twin": df["oil_temp_twin"],
    "vibration_rms_g": df["vibration_rms_g"],
    "predicted_fault_class": pred_class,
    "predicted_fault_name": [class_names[c] for c in pred_class],
    "fault_confidence": fault_conf.round(3),
    "predicted_RUL": rul_pred.round(1),
})
out["mission_reliability_pct"] = (out["predicted_RUL"].clip(0, 125) / 125 * 100).where(
    out["predicted_fault_class"] != 0, 100.0).round(1)

out.to_csv("digital_twin_demo_unit%d.csv" % unit_id, index=False)
print(f"Demo unit {unit_id} ({len(out)} cycles). Fault onset detected at cycle:",
      int(out.loc[out['predicted_fault_class'] != 0, 'cycle'].min()) if (out['predicted_fault_class'] != 0).any() else None,
      "| true onset cycle:", int(out.loc[out['true_fault_class'] != 0, 'cycle'].min()))
print(out.tail(5).to_string(index=False))
