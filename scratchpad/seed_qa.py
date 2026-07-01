import json
import urllib.request

BASE = "http://localhost:8090"


def post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())
        print(f"POST {path} -> {resp.status} id={body.get('id')}")
        return body


project_md = """# QA Demo — Project Profile

Progetto seed per il QA dello stack scratch Sethlans Board (storie 1+2+3:
export/import, fix tabelle MD, vista Cards).

## Repo & stack

| Repo | Stack | Ruolo |
|---|---|---|
| `qa-frontend` | Angular 20 / pnpm | UI demo |
| `qa-backend` | FastAPI / Python 3.12 | API demo |
| `qa-worker` | Node 22 | Job asincroni |

## Note

Questa tabella serve a verificare il fix di rendering delle tabelle Markdown
nel pannello knowledge/profilo.
"""

pid = "pfa8584da"  # progetto già creato dal run precedente

# Knowledge cards da ruoli diversi
post(
    "/knowledge",
    {
        "project_id": pid,
        "title": "PO — contesto di business",
        "role": "po",
        "kind": "kb",
        "source": "manual",
        "md": "## Contesto\nDemo card PO per QA. Nessun dato reale.",
    },
)

post(
    "/knowledge",
    {
        "project_id": pid,
        "title": "Architetto — decisioni chiave",
        "role": "seth-architect",
        "kind": "kb",
        "source": "manual",
        "md": "## ADR-001\nScelta scratch stack Docker isolato per QA (porta 8090/8091).",
    },
)

post(
    "/knowledge",
    {
        "project_id": pid,
        "title": "Reviewer — standard di codice",
        "role": "seth-reviewer",
        "kind": "standards",
        "source": "manual",
        "md": """## Standard di progetto (demo)

| Area | Regola | Enforced |
|---|---|---|
| Backend | Docstring in italiano | si |
| Frontend | No barrel import | si |
| Test | Coverage minima 80% | no |

Card di tipo `standards` per verificare il fix tabelle MD e il filtro per kind.
""",
    },
)

post(
    "/knowledge",
    {
        "project_id": pid,
        "title": "Tester — ambienti QA",
        "role": "seth-tester",
        "kind": "kb",
        "source": "manual",
        "md": "## Ambienti\n- Frontend scratch: http://localhost:8091\n- API scratch: http://localhost:8090",
    },
)

# Design system
post(
    "/design-systems",
    {
        "project_id": pid,
        "title": "QA Demo Design System",
        "md": "## Design tokens (demo)\n\n| Token | Valore |\n|---|---|\n| color.primary | #1a73e8 |\n| radius.md | 8px |\n",
        "tokens": json.dumps({"color": {"primary": "#1a73e8"}, "radius": {"md": "8px"}}),
        "components": json.dumps(["Button", "Card", "Modal"]),
        "source": "code_scan",
        "sync_state": "local",
    },
)

print("Seed completato. project_id =", pid)
