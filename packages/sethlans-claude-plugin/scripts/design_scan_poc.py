"""
PoC/test per la logica di scan L1 (token CSS) usata dalla skill /sethlans-design.
Non fa parte del comando shippato (la skill esegue il ragionamento direttamente in Claude),
ma isola le funzioni di parsing in modo testabile con pytest/unittest.

Esegui: python design_scan_poc.py <path-styles.css> [altri.css ...]
"""
import json
import re
import sys
from pathlib import Path

# --- Scan L1: CSS custom properties -----------------------------------------

CUSTOM_PROP_RE = re.compile(r'(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);')


def extract_custom_properties(css_text: str) -> dict:
    """Estrae le CSS custom properties (--xxx: valore) dal testo CSS.
    Ritorna {nome: valore} mantenendo l'ultima definizione vista (coerente con
    la semantica CSS "ultima dichiarazione vince" in uno stesso :root)."""
    tokens = {}
    for m in CUSTOM_PROP_RE.finditer(css_text):
        name, value = m.group(1), m.group(2).strip()
        # scarta i commenti inline residui
        value = re.sub(r'/\*.*?\*/', '', value).strip()
        if value:
            tokens[name] = value
    return tokens


def classify_tokens(props: dict) -> dict:
    """Divide le custom properties in colori vs altro (spacing/radius non sono
    quasi mai custom properties in questo progetto: dedotti via L1-bis sotto)."""
    colors = {}
    other = {}
    color_re = re.compile(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^rgba?\(|^hsla?\(')
    for name, value in props.items():
        if color_re.match(value):
            colors[name] = value
        else:
            other[name] = value
    return {"colors": colors, "other": other}


# --- Scan L1-bis: pattern tipografici/spacing/radius ricorrenti -------------

FONT_RULE_RE = re.compile(
    r'font-size:\s*([0-9.]+px)\s*;\s*(?:[^}]*?font-weight:\s*([0-9]+))?', re.IGNORECASE
)
RADIUS_RE = re.compile(r'border-radius:\s*([0-9.]+px)', re.IGNORECASE)
SPACING_RE = re.compile(r'(?:padding|gap|margin):\s*([0-9.]+px)', re.IGNORECASE)


def extract_typography(css_text: str, top_n: int = 6) -> list:
    """Conta le combinazioni font-size (+ font-weight se sulla stessa dichiarazione)
    più ricorrenti nel CSS, come proxy di scala tipografica in uso."""
    counts = {}
    for m in re.finditer(r'\{([^}]*)\}', css_text):
        block = m.group(1)
        size_m = re.search(r'font-size:\s*([0-9.]+px)', block)
        if not size_m:
            continue
        weight_m = re.search(r'font-weight:\s*([0-9]+)', block)
        key = (size_m.group(1), weight_m.group(1) if weight_m else None)
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:top_n]
    return [{"font_size": k[0], "font_weight": k[1], "occurrences": c} for k, c in ranked]


def extract_dimension_scale(css_text: str, pattern: re.Pattern, top_n: int = 6) -> list:
    counts = {}
    for m in pattern.finditer(css_text):
        v = m.group(1)
        counts[v] = counts.get(v, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:top_n]
    return [{"value": v, "occurrences": c} for v, c in ranked]


# --- Scan L2: inventario componenti (best-effort, per nome) -----------------

COMPONENT_HEURISTICS = [
    ("badge", r'\.badge\b'),
    ("chip", r'\.chip\b'),
    ("card", r'\.\w*card\b'),
    ("btn-primary", r'\.btn-primary\b'),
    ("btn-ghost", r'\.btn-ghost\b'),
    ("open-ext-btn", r'\.open-ext-btn\b'),
    ("empty-state", r'\.empty-state\b'),
    ("type-badge", r'\.type-badge\b'),
]


def extract_components(css_text: str) -> list:
    found = []
    for name, pattern in COMPONENT_HEURISTICS:
        if re.search(pattern, css_text):
            found.append({"name": name, "example": f'<span class="{name}">...</span>'})
    return found


def build_tokens_payload(css_texts: list) -> dict:
    merged_props = {}
    merged_css = "\n".join(css_texts)
    for css in css_texts:
        merged_props.update(extract_custom_properties(css))
    classified = classify_tokens(merged_props)
    return {
        "colors": classified["colors"],
        "other_properties": classified["other"],
        "typography": extract_typography(merged_css),
        "spacing": extract_dimension_scale(merged_css, SPACING_RE),
        "radius": extract_dimension_scale(merged_css, RADIUS_RE),
    }


def build_components_payload(css_texts: list) -> list:
    merged_css = "\n".join(css_texts)
    return extract_components(merged_css)


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print("usage: python design_scan_poc.py <css-file> [...]")
        sys.exit(1)
    texts = [Path(p).read_text(encoding="utf-8") for p in paths]
    tokens = build_tokens_payload(texts)
    components = build_components_payload(texts)
    print(json.dumps({"tokens": tokens, "components": components}, indent=2))
