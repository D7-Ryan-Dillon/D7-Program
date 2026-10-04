"""Runs every headless engine test. Usage (Rhino's Python, see ../run_headless.py header):
    python run_all.py
Exit code 0 = all passed."""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TESTS = ["t_golden", "t_plates", "t_flat_support", "t_top", "t_components", "t_geo_recipe", "t_wedge", "t_mass_exact"]
failed = []
for t in TESTS:
    r = subprocess.run([sys.executable, os.path.join(HERE, t + ".py"), REPO], capture_output=True, text=True)
    out = r.stdout + r.stderr
    bad = r.returncode != 0 or any(tag in out for tag in (" FAIL", "SOME FAILED", "GOLDEN FAIL"))
    print("%-16s %s" % (t, "FAILED" if bad else "ok"))
    if bad:
        failed.append(t)
        print(out[-2500:])
print("ALL TESTS PASSED" if not failed else "FAILED: " + ", ".join(failed))
sys.exit(1 if failed else 0)
