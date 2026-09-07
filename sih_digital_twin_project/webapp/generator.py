"""
Physics-informed synthetic Digital Twin dataset generator
===========================================================
Aero piston engine (4-cylinder, Rotax-912/914-class — representative of engines
used on MALE-class UAVs such as Heron/Searcher) health-monitoring dataset.

WHY SYNTHETIC: No public dataset of real MALE UAV piston-engine telemetry
exists (OEM/military proprietary). This generator instead builds a
physics-informed simulation: baseline engine behaviour follows simplified
thermodynamic/empirical relations parameterised with values drawn from public
general-aviation piston-engine literature (typical CHT/EGT/oil operating
bands reported by engine-monitor vendors and GA maintenance references), NOT
from any specific classified system. All assumptions are declared as
constants below so they are auditable and can be swapped for real values if
they ever become available.

STRUCTURE mirrors NASA C-MAPSS (the community-standard PdM benchmark):
  - train: full run-to-failure (or full-mission, for healthy units) trajectories
  - test:  trajectories truncated at a random cutoff before failure
  - RUL labels use the piecewise-linear convention (Heimes, 2008 / PHM08):
    RUL is capped at RUL_CAP cycles because degradation is not linear from
    time zero — this is standard practice in the RUL-prediction literature,
    not an invented shortcut.
"""
import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)

# ---------------------------------------------------------------------------
# Declared physical assumptions (representative GA piston-engine ranges;
# see README for sources). Edit these if better figures become available.
# ---------------------------------------------------------------------------
N_CYL = 4
RPM_IDLE, RPM_CRUISE, RPM_MAX = 2000, 5000, 5800
CHT_AMBIENT_BASE = 25.0          # deg C, ground ambient reference
CHT_CRUISE_NOM = 115.0           # deg C, typical healthy cruise CHT
CHT_MAX_SAFE = 150.0             # deg C, manufacturer caution threshold (typical)
EGT_CRUISE_NOM = 720.0           # deg C, typical healthy cruise EGT
EGT_MAX_SAFE = 880.0             # deg C
OIL_P_NOM = 140.0                # kPa, healthy oil pressure at cruise
OIL_P_MIN_SAFE = 80.0            # kPa
OIL_T_NOM = 95.0                 # deg C
OIL_T_MAX_SAFE = 130.0
FUEL_FLOW_NOM = 18.0             # L/h at cruise power
VIB_NOM = 0.08                   # g RMS, healthy baseline
RUL_CAP = 125                    # piecewise-linear RUL cap (cycles), standard PHM convention

FAULT_CLASSES = {
    0: "healthy",
    1: "spark_plug_fouling",
    2: "exhaust_valve_leak",
    3: "cooling_airflow_blockage",
    4: "fuel_injector_clog",
    5: "oil_starvation",
    6: "bearing_wear",
    7: "fuel_pump_degradation",
}


def mission_profile(n_cycles):
    """1 cycle == 1 minute of flight. Builds a MALE-style profile: short climb,
    long loiter/cruise (endurance mission), short descent."""
    climb_end = int(n_cycles * 0.12)
    descent_start = int(n_cycles * 0.90)
    throttle = np.empty(n_cycles)
    altitude_m = np.empty(n_cycles)
    airspeed_kmh = np.empty(n_cycles)

    throttle[:climb_end] = np.linspace(0.85, 0.90, climb_end)
    altitude_m[:climb_end] = np.linspace(0, 4500, climb_end)
    airspeed_kmh[:climb_end] = np.linspace(90, 130, climb_end)

    cruise_len = descent_start - climb_end
    throttle[climb_end:descent_start] = 0.60 + 0.05 * np.sin(np.linspace(0, 6, cruise_len))
    altitude_m[climb_end:descent_start] = 4500 + 300 * np.sin(np.linspace(0, 4, cruise_len))
    airspeed_kmh[climb_end:descent_start] = 130 + 5 * np.sin(np.linspace(0, 5, cruise_len))

    tail = n_cycles - descent_start
    throttle[descent_start:] = np.linspace(0.55, 0.30, tail)
    altitude_m[descent_start:] = np.linspace(4500, 0, tail)
    airspeed_kmh[descent_start:] = np.linspace(125, 95, tail)

    throttle = np.clip(throttle + RNG.normal(0, 0.01, n_cycles), 0.25, 0.95)
    return throttle, altitude_m, airspeed_kmh


def fault_signature(fault_id, severity, cyl):
    """Returns per-channel additive deltas for a given fault at a given severity
    in [0,1]. `cyl` selects which cylinder is primarily affected (single-cylinder
    faults) — the others get a smaller correlated delta."""
    d_cht = np.zeros(N_CYL); d_egt = np.zeros(N_CYL)
    d_oilP = d_oilT = d_vib = d_fuel = d_rpm = 0.0

    if fault_id == 1:  # spark plug fouling -> misfire on one cylinder
        d_egt[cyl] += 90 * severity
        d_cht[cyl] += 8 * severity
        d_vib += 0.35 * severity
        d_rpm -= 60 * severity
    elif fault_id == 2:  # exhaust valve leak -> localized overheat
        d_cht[cyl] += 35 * severity
        d_egt[cyl] += 110 * severity
        d_rpm -= 40 * severity
    elif fault_id == 3:  # cooling airflow blockage -> global overheat
        d_cht += 45 * severity
        d_oilT += 20 * severity
    elif fault_id == 4:  # fuel injector clog -> lean mixture
        d_egt += 70 * severity
        d_cht += 20 * severity
        d_vib += 0.15 * severity
    elif fault_id == 5:  # oil starvation
        d_oilP -= 70 * severity
        d_oilT += 30 * severity
        d_vib += 0.25 * severity
    elif fault_id == 6:  # bearing wear
        d_vib += 0.55 * severity
        d_rpm -= 20 * severity
    elif fault_id == 7:  # fuel pump degradation
        d_fuel -= 6 * severity
        d_rpm -= 150 * severity
        d_egt += 60 * severity

    return d_cht, d_egt, d_oilP, d_oilT, d_vib, d_fuel, d_rpm


def simulate_unit(unit_id, fault_id, n_cycles, onset_frac, degrade_len):
    throttle, alt_m, spd = mission_profile(n_cycles)
    density_ratio = np.clip(1 - alt_m / 44330, 0.55, 1.0) ** 4.256  # ISA approx
    cyl = RNG.integers(0, N_CYL)

    rows = []
    onset = int(n_cycles * onset_frac) if fault_id != 0 else n_cycles + 1
    for t in range(n_cycles):
        # severity ramps 0->1 over degrade_len cycles after onset; caps at 1 (failure)
        if fault_id == 0 or t < onset:
            severity = 0.0
        else:
            severity = min(1.0, (t - onset) / max(degrade_len, 1))

        rpm = RPM_IDLE + throttle[t] * (RPM_MAX - RPM_IDLE)
        power_frac = throttle[t] * density_ratio[t]
        cooling = 0.4 + 0.6 * (spd[t] / 130)  # airspeed-driven cooling airflow

        cht_base = CHT_AMBIENT_BASE + (CHT_CRUISE_NOM - CHT_AMBIENT_BASE) * power_frac / cooling
        egt_base = EGT_CRUISE_NOM * (0.6 + 0.4 * power_frac)
        oilP_base = OIL_P_NOM * (0.85 + 0.15 * (rpm / RPM_CRUISE))
        oilT_base = OIL_T_NOM * (0.8 + 0.2 * power_frac)
        fuel_base = FUEL_FLOW_NOM * (0.4 + 0.6 * power_frac)

        d_cht, d_egt, d_oilP, d_oilT, d_vib, d_fuel, d_rpm = fault_signature(fault_id, severity, cyl)

        cht = cht_base + d_cht + RNG.normal(0, 1.2, N_CYL)
        egt = egt_base + d_egt + RNG.normal(0, 6, N_CYL)
        rpm_noisy = rpm + d_rpm + RNG.normal(0, 8)
        oilP = oilP_base + d_oilP + RNG.normal(0, 2.5)
        oilT = oilT_base + d_oilT + RNG.normal(0, 1.0)
        fuel = fuel_base + d_fuel + RNG.normal(0, 0.3)
        vib = VIB_NOM + d_vib + abs(RNG.normal(0, 0.02))

        rul_true = max(0, onset + degrade_len - t) if fault_id != 0 else (n_cycles - t)
        rul_label = min(rul_true, RUL_CAP)

        # Digital-twin prediction = the same physics model run with NO fault deltas
        # (this is what a real-time twin running in parallel would output as the
        # "expected healthy" reading; residual = observed - twin is the anomaly signal)
        rows.append(dict(
            unit_number=unit_id, cycle=t + 1,
            mission_altitude_m=round(alt_m[t], 1),
            mission_airspeed_kmh=round(spd[t], 1),
            throttle_pct=round(throttle[t] * 100, 1),
            rpm=round(rpm_noisy, 1),
            rpm_twin=round(rpm, 1),
            oil_pressure_kpa=round(oilP, 1),
            oil_pressure_twin=round(oilP_base, 1),
            oil_temp_c=round(oilT, 1),
            oil_temp_twin=round(oilT_base, 1),
            fuel_flow_lph=round(fuel, 2),
            fuel_flow_twin=round(fuel_base, 2),
            vibration_rms_g=round(vib, 3),
            **{f"cht_{i+1}_c": round(cht[i], 1) for i in range(N_CYL)},
            **{f"cht_{i+1}_twin": round(cht_base, 1) for i in range(N_CYL)},
            **{f"egt_{i+1}_c": round(egt[i], 1) for i in range(N_CYL)},
            **{f"egt_{i+1}_twin": round(egt_base, 1) for i in range(N_CYL)},
            fault_class=fault_id if severity > 0 else 0,
            fault_name=FAULT_CLASSES[fault_id] if severity > 0 else "healthy",
            fault_severity=round(severity, 3),
            RUL=rul_label,
            failed_at_end=int(fault_id != 0 and severity >= 1.0 and t == onset + degrade_len),
        ))
        if fault_id != 0 and severity >= 1.0:
            break
    return pd.DataFrame(rows)


def build_dataset(n_units=100, healthy_frac=0.2, seed=42):
    global RNG
    RNG = np.random.default_rng(seed)
    all_units = []
    fault_ids = list(FAULT_CLASSES.keys())[1:]
    for uid in range(1, n_units + 1):
        n_cycles = int(RNG.integers(250, 700))
        if RNG.random() < healthy_frac:
            df = simulate_unit(uid, 0, n_cycles, 0, 0)
        else:
            fid = RNG.choice(fault_ids)
            onset_frac = RNG.uniform(0.15, 0.55)
            degrade_len = int(RNG.integers(40, 160))
            df = simulate_unit(uid, fid, n_cycles, onset_frac, degrade_len)
        all_units.append(df)
    full = pd.concat(all_units, ignore_index=True)
    return full


def split_train_test(full_df, cutoff_frac_range=(0.4, 0.9)):
    """Mirrors C-MAPSS test-set convention: truncate each unit's trajectory at a
    random point before its end/failure; report true remaining RUL at cutoff."""
    train_rows, test_rows, rul_test = [], [], []
    for uid, g in full_df.groupby("unit_number"):
        g = g.reset_index(drop=True)
        train_rows.append(g)
        cutoff = int(len(g) * RNG.uniform(*cutoff_frac_range))
        cutoff = max(cutoff, 1)
        test_rows.append(g.iloc[:cutoff].drop(columns=["RUL", "fault_severity", "fault_class", "fault_name", "failed_at_end"]))
        rul_test.append(dict(unit_number=uid, RUL=int(g.iloc[cutoff - 1]["RUL"])))
    return pd.concat(train_rows, ignore_index=True), pd.concat(test_rows, ignore_index=True), pd.DataFrame(rul_test)


if __name__ == "__main__":
    full = build_dataset(n_units=100)
    train, test, rul_test = split_train_test(full)
    train.to_csv("data/synthetic_train.csv", index=False)
    test.to_csv("data/synthetic_test.csv", index=False)
    rul_test.to_csv("data/synthetic_RUL_test.csv", index=False)
    print("train:", train.shape, "test:", test.shape)
    print(train["fault_name"].value_counts())
