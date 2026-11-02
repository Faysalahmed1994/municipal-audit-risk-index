"""Dashboard demo: example records are synthetic, not municipal findings."""
from pathlib import Path
import sys
import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent / "src"))
from municipal_risk import score_municipalities

st.set_page_config(page_title="Municipal Risk Screening", layout="wide")
st.title("Municipal Financial Risk Screening")
st.caption("Exploratory heuristic screening · not a validated prediction or audit opinion")
choice = st.radio("Dataset", ["Fictional demonstration", "Upload your own CSV"], horizontal=True)
if choice == "Fictional demonstration":
    st.warning("SYNTHETIC EXAMPLES ONLY: these amounts and names are invented.")
    frame = pd.read_csv(Path(__file__).parent / "examples" / "synthetic_data.csv")
else:
    file = st.file_uploader("Upload data matching docs/data_dictionary.md", type="csv")
    if file is None:
        st.info("Select a CSV file to calculate scores.")
        st.stop()
    frame = pd.read_csv(file, dtype={"municipality_id": "string"})
try:
    result = score_municipalities(frame)
except (ValueError, TypeError, pd.errors.ParserError) as exc:
    st.error(f"Input validation error: {exc}")
    st.stop()
valid = result[result["data_complete"]].copy()
a,b,c = st.columns(3)
a.metric("Municipality-year observations", len(result))
b.metric("Complete scores", len(valid))
c.metric("High-risk observations", int((valid["risk_level"] == "High").sum()))
if len(valid):
    year = st.selectbox("Fiscal year", sorted(valid["fiscal_year"].unique(), reverse=True))
    current = valid[valid["fiscal_year"] == year].sort_values("risk_score")
    st.bar_chart(current.set_index("municipality_name")["risk_score"], horizontal=True)
else:
    st.warning("No observations have complete ratio data.")
st.subheader("Details and data completeness")
st.dataframe(result, hide_index=True, use_container_width=True)
st.download_button("Export scored CSV", result.to_csv(index=False).encode(),
                   file_name="municipal_risk_scores.csv", mime="text/csv")
st.caption("The weights, bands and thresholds are provisional and unvalidated. "
           "Audit lag is tracked separately and does not establish legal lateness.")
