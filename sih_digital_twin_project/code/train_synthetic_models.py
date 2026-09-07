import json
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report, confusion_matrix, mean_absolute_error

from features import add_features

train_raw = pd.read_csv("data/synthetic_train.csv")
df, feature_cols = add_features(train_raw)

# --- split by unit_number (never split a trajectory across train/val) -----
gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
tr_idx, val_idx = next(gss.split(df, groups=df["unit_number"]))
tr, val = df.iloc[tr_idx], df.iloc[val_idx]

# ============================= FAULT CLASSIFIER =============================
clf = RandomForestClassifier(n_estimators=300, max_depth=14, min_samples_leaf=3,
                              class_weight="balanced_subsample", random_state=42, n_jobs=-1)
clf.fit(tr[feature_cols], tr["fault_class"])
pred = clf.predict(val[feature_cols])

report = classification_report(val["fault_class"], pred, zero_division=0, output_dict=True)
cm = confusion_matrix(val["fault_class"], pred).tolist()
print(classification_report(val["fault_class"], pred, zero_division=0))

importances = sorted(zip(feature_cols, clf.feature_importances_), key=lambda x: -x[1])[:10]
print("\nTop 10 features (fault classifier):")
for name, imp in importances:
    print(f"  {name}: {imp:.3f}")

# ================================ RUL REGRESSOR ==============================
# Train only on rows belonging to units that actually have a fault trajectory,
# since RUL-to-failure is undefined/uninformative for permanently-healthy units.
fault_units = df.loc[df["fault_class"] != 0, "unit_number"].unique()
rul_df = df[df["unit_number"].isin(fault_units)]
tr_idx2, val_idx2 = next(gss.split(rul_df, groups=rul_df["unit_number"]))
tr2, val2 = rul_df.iloc[tr_idx2], rul_df.iloc[val_idx2]

reg = GradientBoostingRegressor(n_estimators=300, max_depth=4, learning_rate=0.05, random_state=42)
reg.fit(tr2[feature_cols], tr2["RUL"])
rul_pred = reg.predict(val2[feature_cols])
mae = mean_absolute_error(val2["RUL"], rul_pred)
print(f"\nRUL regressor MAE (capped at {125} cycles): {mae:.1f} cycles")

# ============================ SAVE ARTIFACTS =================================
joblib.dump(clf, "models_fault_classifier.joblib")
joblib.dump(reg, "models_rul_regressor.joblib")
with open("feature_cols.json", "w") as f:
    json.dump(feature_cols, f)

metrics = {
    "fault_classifier": {"macro_f1": report["macro avg"]["f1-score"],
                          "weighted_f1": report["weighted avg"]["f1-score"],
                          "per_class_f1": {k: v["f1-score"] for k, v in report.items()
                                           if k.isdigit()},
                          "confusion_matrix": cm,
                          "class_labels": sorted(df["fault_class"].unique().tolist())},
    "rul_regressor": {"val_mae_cycles": mae, "rul_cap": 125}
}
with open("synthetic_model_metrics.json", "w") as f:
    json.dump(metrics, f, indent=2)
print("\nSaved model artifacts + synthetic_model_metrics.json")
