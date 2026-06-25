"""
Test minimi per la logica di scan L1/L2 di /sethlans-design (design_scan_poc.py).
Esegui: python -m pytest packages/sethlans-claude-plugin/scripts/test_design_scan_poc.py -q
(richiede pytest installato; se assente: python -m unittest discover su questo file).
"""
import json
from pathlib import Path

import design_scan_poc as scan

FIXTURE_CSS = """
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --c-prog: #d29922;
  --epic: #2f81f7;
  --radius-base: 8px;
}
.title { font-size: 18px; font-weight: 700; }
.card-title { font-size: 13.5px; font-weight: 600; }
.card-title2 { font-size: 13.5px; font-weight: 600; }
.badge { border-radius: 5px; padding: 3px 8px; }
.chip { border-radius: 20px; }
.btn-primary { border-radius: 7px; }
.btn-ghost { border-radius: 7px; }
.empty-state { padding: 30px; }
"""


def test_extract_custom_properties_finds_all_vars():
    props = scan.extract_custom_properties(FIXTURE_CSS)
    assert props["--bg"] == "#0d1117"
    assert props["--panel"] == "#161b22"
    assert props["--c-prog"] == "#d29922"
    assert props["--epic"] == "#2f81f7"
    assert props["--radius-base"] == "8px"


def test_classify_tokens_splits_colors_from_other():
    props = scan.extract_custom_properties(FIXTURE_CSS)
    classified = scan.classify_tokens(props)
    assert "--bg" in classified["colors"]
    assert "--radius-base" in classified["other"]
    assert "--radius-base" not in classified["colors"]


def test_extract_typography_ranks_by_occurrences():
    typo = scan.extract_typography(FIXTURE_CSS)
    top = typo[0]
    assert top["font_size"] == "13.5px"
    assert top["font_weight"] == "600"
    assert top["occurrences"] == 2


def test_extract_components_detects_known_patterns():
    components = scan.extract_components(FIXTURE_CSS)
    names = {c["name"] for c in components}
    assert {"badge", "chip", "btn-primary", "btn-ghost", "empty-state"} <= names
    # "card" e' rilevato anche da ".card-title"/".card-title2" (euristica per nome,
    # non semantica: un prefisso "card" nel selettore basta a segnalare il pattern)
    assert "card" in names
    # non presente in questa fixture
    assert "open-ext-btn" not in names


def test_build_tokens_payload_shape():
    payload = scan.build_tokens_payload([FIXTURE_CSS])
    assert set(payload.keys()) == {"colors", "other_properties", "typography", "spacing", "radius"}
    assert payload["colors"]["--epic"] == "#2f81f7"


def test_scan_is_idempotent_on_same_input():
    a = scan.build_tokens_payload([FIXTURE_CSS])
    b = scan.build_tokens_payload([FIXTURE_CSS])
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_real_project_styles_css_produces_known_tokens():
    real_css_path = (
        Path(__file__).resolve().parents[2]
        / "sethlans-board" / "frontend" / "src" / "styles.css"
    )
    if not real_css_path.exists():
        return  # ambiente senza il repo board frontend: skip silenzioso
    text = real_css_path.read_text(encoding="utf-8")
    payload = scan.build_tokens_payload([text])
    assert payload["colors"]["--bg"] == "#0d1117"
    assert payload["colors"]["--story"] == "#8957e5"
    components = scan.build_components_payload([text])
    names = {c["name"] for c in components}
    assert "badge" in names
    assert "btn-primary" in names
