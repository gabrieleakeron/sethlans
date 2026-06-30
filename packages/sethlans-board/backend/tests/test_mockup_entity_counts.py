"""Test unitari per la correzione dei contatori mockup (task t762713d4).

Verifica che mockup_count (task/story) e mockup_descendant_count (story/epic) tengano
conto delle righe entità nella tabella mockups, non solo dei blocchi legacy nel md.
Copre i 6 casi elencati nel task md:

  1. owner con SOLA riga entità → count = 1 (md vuoto).
  2. owner con SOLO blocco legacy nel md, nessuna riga → count = n blocchi.
  3. owner MISTO (riga entità + blocco md residuo) → count = righe entità (no doppio conteggio).
  4. story con mockup su un TASK discendente → mockup_descendant_count include il task.
  5. epic che aggrega story/task con mockup entità → mockup_descendant_count corretto.
  6. nessun mockup ovunque → tutti 0 (no regressione).

Non usa Testcontainers né Postgres reale: SQLite in-memory tramite la fixture `client`
del conftest esistente. Integrazione/E2E è responsabilità del seth-tester.
"""

MOCKUP_BLOCK = "```mockup\n<html></html>\n```"


def _base_hierarchy(client):
    """Crea project → epic → story → task senza mockup, restituisce i dict."""
    project = client.post("/projects", json={"name": "P-counts"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    story = client.post("/stories", json={"title": "S", "epic_id": epic["id"]}).json()
    task = client.post("/tasks", json={"title": "T", "story_id": story["id"]}).json()
    return project, epic, story, task


# ---------- Caso 1: solo riga entità (md vuoto) ----------

def test_story_entity_row_only(client):
    """Story con riga Mockup entità e md vuoto → mockup_count = 1."""
    _, _, story, _ = _base_hierarchy(client)
    client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "M1"},
    )
    got = client.get(f"/stories/{story['id']}").json()
    assert got["mockup_count"] == 1, f"atteso 1, ottenuto {got['mockup_count']}"


def test_task_entity_row_only(client):
    """Task con riga Mockup entità e md vuoto → mockup_count = 1."""
    _, _, _, task = _base_hierarchy(client)
    client.post(
        "/mockups",
        json={"owner_type": "task", "owner_id": task["id"], "title": "M-task"},
    )
    got = client.get(f"/tasks/{task['id']}").json()
    assert got["mockup_count"] == 1, f"atteso 1, ottenuto {got['mockup_count']}"


# ---------- Caso 2: solo blocco legacy nel md ----------

def test_story_legacy_only(client):
    """Story con blocchi ```mockup``` nel md e nessuna riga entità → count = n blocchi."""
    project = client.post("/projects", json={"name": "P-legacy"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    md = MOCKUP_BLOCK + "\n\n" + MOCKUP_BLOCK
    story = client.post("/stories", json={"title": "S", "epic_id": epic["id"], "md": md}).json()
    got = client.get(f"/stories/{story['id']}").json()
    assert got["mockup_count"] == 2, f"atteso 2, ottenuto {got['mockup_count']}"


def test_task_legacy_only(client):
    """Task con 3 blocchi ```mockup``` nel md e nessuna riga entità → count = 3."""
    _, _, story, _ = _base_hierarchy(client)
    md = (MOCKUP_BLOCK + "\n") * 3
    task = client.post("/tasks", json={"title": "T-legacy", "story_id": story["id"], "md": md}).json()
    got = client.get(f"/tasks/{task['id']}").json()
    assert got["mockup_count"] == 3, f"atteso 3, ottenuto {got['mockup_count']}"


# ---------- Caso 3: misto (riga entità + blocco md residuo) → no doppio conteggio ----------

def test_story_mixed_no_double_count(client):
    """Story con 1 blocco md legacy E 1 riga entità → count = 1 (righe entità, non somma).

    Simula un owner parzialmente migrato: ha già una riga in mockups ma ha ancora
    blocchi ```mockup``` nel md rimasti dalla fase pre-backfill.
    """
    project = client.post("/projects", json={"name": "P-mixed"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    md = MOCKUP_BLOCK  # un blocco legacy residuo
    story = client.post("/stories", json={"title": "S", "epic_id": epic["id"], "md": md}).json()
    # Aggiunge una riga entità (post-backfill)
    client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "M-entity"},
    )
    got = client.get(f"/stories/{story['id']}").json()
    # Deve essere 1 (righe entità), non 2 (1 entità + 1 legacy)
    assert got["mockup_count"] == 1, f"atteso 1 (no doppio conteggio), ottenuto {got['mockup_count']}"


def test_task_mixed_no_double_count(client):
    """Task con 2 blocchi md legacy E 1 riga entità → count = 1 (righe entità, non somma)."""
    _, _, story, _ = _base_hierarchy(client)
    md = (MOCKUP_BLOCK + "\n") * 2
    task = client.post("/tasks", json={"title": "T-mixed", "story_id": story["id"], "md": md}).json()
    client.post(
        "/mockups",
        json={"owner_type": "task", "owner_id": task["id"], "title": "M-entity"},
    )
    got = client.get(f"/tasks/{task['id']}").json()
    assert got["mockup_count"] == 1, f"atteso 1 (no doppio conteggio), ottenuto {got['mockup_count']}"


# ---------- Caso 4: mockup entità su task discendente → story.mockup_descendant_count ----------

def test_story_descendant_count_includes_task_entity_rows(client):
    """Story senza mockup propri + task con 2 righe entità → mockup_descendant_count = 2."""
    _, _, story, task = _base_hierarchy(client)
    client.post("/mockups", json={"owner_type": "task", "owner_id": task["id"], "title": "M1"})
    client.post("/mockups", json={"owner_type": "task", "owner_id": task["id"], "title": "M2"})
    got = client.get(f"/stories/{story['id']}").json()
    assert got["mockup_count"] == 0, f"story propria attesa 0, ottenuta {got['mockup_count']}"
    assert got["mockup_descendant_count"] == 2, (
        f"descendant atteso 2, ottenuto {got['mockup_descendant_count']}"
    )


# ---------- Caso 5: epic aggrega story/task con righe entità ----------

def test_epic_descendant_count_aggregates_entity_rows(client):
    """Epic con story + task entrambi con righe entità → mockup_descendant_count corretto."""
    _, epic, story, task = _base_hierarchy(client)
    # 1 mockup sulla story, 2 sul task
    client.post("/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "S-M1"})
    client.post("/mockups", json={"owner_type": "task", "owner_id": task["id"], "title": "T-M1"})
    client.post("/mockups", json={"owner_type": "task", "owner_id": task["id"], "title": "T-M2"})
    got = client.get(f"/epics/{epic['id']}").json()
    # 1 (story) + 2 (task) = 3; epic.md vuoto → 0 propri
    assert got["mockup_descendant_count"] == 3, (
        f"epic descendant atteso 3, ottenuto {got['mockup_descendant_count']}"
    )


# ---------- Caso 6: nessun mockup ovunque → tutti 0 ----------

def test_zero_mockups_everywhere(client):
    """Nessun mockup in nessun owner → tutti i contatori a 0 (no regressione)."""
    _, epic, story, task = _base_hierarchy(client)
    story_data = client.get(f"/stories/{story['id']}").json()
    task_data = client.get(f"/tasks/{task['id']}").json()
    epic_data = client.get(f"/epics/{epic['id']}").json()
    assert task_data["mockup_count"] == 0
    assert story_data["mockup_count"] == 0
    assert story_data["mockup_descendant_count"] == 0
    assert epic_data["mockup_descendant_count"] == 0


# ---------- Verifica /state espone i nuovi contatori ----------

def test_state_story_mockup_count_entity_based(client):
    """Lo snapshot /state deve esporre mockup_count aggiornato con le righe entità."""
    _, _, story, _ = _base_hierarchy(client)
    client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "Snap-M"},
    )
    state = client.get("/state").json()
    story_in_state = next(s for s in state["stories"] if s["id"] == story["id"])
    assert story_in_state["mockup_count"] == 1, (
        f"state story mockup_count atteso 1, ottenuto {story_in_state['mockup_count']}"
    )
