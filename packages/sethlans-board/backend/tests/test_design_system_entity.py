"""Test unitari per l'entità `DesignSystem` (story `s2340fc3b`): modello +
endpoint `/design-systems` (GET lista/detail, upsert idempotente per
`project_id`, PATCH, DELETE) e inclusione in `GET /state`.
Integrazione/E2E (Testcontainers, Postgres reale) sono a carico del seth-tester.
"""
import json


def _project(client, name="P"):
    return client.post("/projects", json={"name": name}).json()


# ---------- POST /design-systems (creazione + upsert idempotente) ----------

def test_create_design_system_defaults(client):
    project = _project(client)
    resp = client.post("/design-systems", json={"project_id": project["id"]})
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"].startswith("ds")
    assert body["project_id"] == project["id"]
    assert body["title"] == "Design System"
    assert body["source"] == "code_scan"
    assert body["sync_state"] == "local"
    assert body["ext_provider"] is None
    assert body["created_at"] is not None
    assert body["updated_at"] is not None


def test_post_design_system_upsert_idempotent_no_duplicate(client):
    """Due POST consecutivi con lo stesso project_id non creano due righe:
    il secondo aggiorna la riga esistente (idempotenza richiesta dalla skill
    `sethlans-design`, che ri-esegue lo scan a ogni invocazione)."""
    project = _project(client)
    first = client.post(
        "/design-systems",
        json={"project_id": project["id"], "tokens": json.dumps({"colors": {"--bg": "#0d1117"}})},
    ).json()

    second = client.post(
        "/design-systems",
        json={
            "project_id": project["id"],
            "title": "Updated DS",
            "tokens": json.dumps({"colors": {"--bg": "#161b22"}}),
            "sync_state": "synced",
        },
    ).json()

    assert second["id"] == first["id"]
    assert second["title"] == "Updated DS"
    assert second["sync_state"] == "synced"
    assert json.loads(second["tokens"])["colors"]["--bg"] == "#161b22"

    # Solo una riga persistita per il project.
    listed = client.get(f"/design-systems?project_id={project['id']}").json()
    assert len(listed) == 1
    assert listed[0]["id"] == first["id"]


def test_create_design_system_unknown_project_404(client):
    resp = client.post("/design-systems", json={"project_id": "pnotfound"})
    assert resp.status_code == 404


def test_create_design_system_invalid_source_422(client):
    project = _project(client)
    resp = client.post("/design-systems", json={"project_id": project["id"], "source": "bogus"})
    assert resp.status_code == 422


def test_create_design_system_invalid_sync_state_422(client):
    project = _project(client)
    resp = client.post("/design-systems", json={"project_id": project["id"], "sync_state": "bogus"})
    assert resp.status_code == 422


def test_create_design_system_invalid_ext_provider_422(client):
    project = _project(client)
    resp = client.post(
        "/design-systems", json={"project_id": project["id"], "ext_provider": "figma"}
    )
    assert resp.status_code == 422


def test_create_design_system_valid_ext_provider_ok(client):
    project = _project(client)
    resp = client.post(
        "/design-systems",
        json={"project_id": project["id"], "ext_provider": "penpot", "ext_url": "https://penpot.example/x"},
    )
    assert resp.status_code == 201
    assert resp.json()["ext_provider"] == "penpot"


# ---------- GET /design-systems, /design-systems/{id} ----------

def test_list_design_systems_filter_by_project(client):
    p1 = _project(client, "P1")
    p2 = _project(client, "P2")
    client.post("/design-systems", json={"project_id": p1["id"]})
    client.post("/design-systems", json={"project_id": p2["id"]})

    only_p1 = client.get(f"/design-systems?project_id={p1['id']}").json()
    assert len(only_p1) == 1
    assert only_p1[0]["project_id"] == p1["id"]


def test_get_design_system_by_id(client):
    project = _project(client)
    created = client.post("/design-systems", json={"project_id": project["id"]}).json()
    got = client.get(f"/design-systems/{created['id']}").json()
    assert got["id"] == created["id"]


def test_get_design_system_unknown_404(client):
    resp = client.get("/design-systems/dsnotfound")
    assert resp.status_code == 404


# ---------- PATCH /design-systems/{id} ----------

def test_patch_design_system_updates_fields(client):
    project = _project(client)
    created = client.post("/design-systems", json={"project_id": project["id"]}).json()
    resp = client.patch(
        f"/design-systems/{created['id']}",
        json={"sync_state": "sync_failed", "ext_provider": "penpot"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sync_state"] == "sync_failed"
    assert body["ext_provider"] == "penpot"
    assert body["updated_at"] != created["updated_at"]


def test_patch_design_system_invalid_enum_422(client):
    project = _project(client)
    created = client.post("/design-systems", json={"project_id": project["id"]}).json()
    resp = client.patch(f"/design-systems/{created['id']}", json={"source": "bogus"})
    assert resp.status_code == 422


# ---------- DELETE /design-systems/{id} ----------

def test_delete_design_system(client):
    project = _project(client)
    created = client.post("/design-systems", json={"project_id": project["id"]}).json()
    resp = client.delete(f"/design-systems/{created['id']}")
    assert resp.status_code == 200
    assert client.get(f"/design-systems/{created['id']}").status_code == 404


# ---------- GET /state ----------

def test_state_includes_design_systems(client):
    project = _project(client)
    created = client.post("/design-systems", json={"project_id": project["id"]}).json()
    state = client.get("/state").json()
    assert "design_systems" in state
    ids = [d["id"] for d in state["design_systems"]]
    assert created["id"] in ids
