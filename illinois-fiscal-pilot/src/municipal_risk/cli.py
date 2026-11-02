"""CLI for scoring municipality-year CSV records."""
import argparse
from pathlib import Path
import pandas as pd
from municipal_risk.scoring import score_municipalities


def main():
    p = argparse.ArgumentParser(description="Generate municipality-year risk scores")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    src = Path(a.input)
    if not src.is_file():
        p.error(f"Input not found: {src}")
    scored = score_municipalities(pd.read_csv(src, dtype={"municipality_id": "string"}))
    dst = Path(a.output)
    dst.parent.mkdir(parents=True, exist_ok=True)
    scored.to_csv(dst, index=False)
    print(f"Wrote {len(scored)} rows, {int(scored['data_complete'].sum())} complete scores.")


if __name__ == "__main__":
    main()
