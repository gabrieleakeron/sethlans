"""Test unitari per export/import dati progetto (story `s09f34f1a`, task `t0b333fc6`).

Copre: forma dell'export (niente id/ext_*), round-trip export→import su progetto
nuovo, merge idempotente (no duplicati, match per role+kind+title), replace
(azzera+reimporta), enum invalidi scartati (skip+warning, mai 500), coerenza
preview/import. Integrazione/E2E (Postgres reale) a carico del seth-tester.
"""


def _project(client, name="P", md="", config=None):
    return client.post("/projects", json={"name": name, "md": md, "config": config or {}}).json()


def _knowledge(client, project_id, **kw):
    body = {"project_id": project_id, "title": "T", "role": "general", "kind": "kb", "source": "manual", "md": ""}
    body.update(kw)
    return client.post("/knowledge", json=body).json()


def _design_system(client, project_id, **kw):
    body = {"project_id": project_id, "title": "DS", "tokens": '{"colors":{}}', "components": "[]"}
    body.update(kw)
    return client.post("/design-systems", json=body).json()


# ---------- GET /projects/{id}/export ----------

def test_export_shape_no_ids_no_ext(client):
    project = _project(client, name="Sethlans", md="# profilo", config={"foo": "bar"})
    _knowledge(client, project["id"], title="Card A", role="seth-fullstack", kind="kb")
    _design_system(client, project["id"], sync_state="synced", ext_provider="penpot", ext_file_id="f1", ext_url="http://x")

    resp = client.get(f"/projects/{project['id']}/export")
    assert resp.status_code == 200
    body = resp.json()

    assert body["sethlans_export_version"] == 1
    assert "exported_at" in body

    assert body["project"]["name"] == "Sethlans"
    assert body["project"]["md"] == "# profilo"
    assert body["project"]["config"] == {"foo": "bar"}
    assert "id" not in body["project"]

    assert len(body["knowledge"]) == 1
    card = body["knowledge"][0]
    assert card["title"] == "Card A"
    assert set(card.keys()) == {"role", "kind", "source", "title", "md"}

    ds = body["design_system"]
    assert set(ds.keys()) == {"title", "md", "tokens", "components", "source"}
    assert "ext_provider" not in ds
    assert "sync_state" not in ds


def test_export_design_system_null_when_absent(client):
    project = _project(client)
    resp = client.get(f"/projects/{project['id']}/export")
    assert resp.json()["design_system"] is None


def test_export_404_on_missing_project(client):
    resp = client.get("/projects/pdoesnotexist/export")
    assert resp.status_code == 404


# ---------- POST /projects/import/preview ----------

def test_preview_invalid_version(client):
    resp = client.post(
        "/projects/import/preview",
        json={"data": {"sethlans_export_version": 99, "project": {"name": "X"}, "knowledge": []}, "target_project_id": None, "mode": "merge"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert any("sethlans_export_version" in e for e in body["errors"])


def test_preview_target_missing_404(client):
    resp = client.post(
        "/projects/import/preview",
        json={"data": {"sethlans_export_version": 1, "project": {"name": "X"}, "knowledge": []}, "target_project_id": "pnope", "mode": "merge"},
    )
    assert resp.status_code == 404


def test_preview_invalid_mode_422(client):
    resp = client.post(
        "/projects/import/preview",
        json={"data": {"sethlans_export_version": 1, "project": {"name": "X"}, "knowledge": []}, "target_project_id": None, "mode": "bogus"},
    )
    assert resp.status_code == 422


def test_preview_warns_on_bad_enum_but_stays_valid(client):
    data = {
        "sethlans_export_version": 1,
        "project": {"name": "X", "md": "", "config": {}},
        "knowledge": [
            {"role": "qa-lead", "kind": "notes", "source": "manual", "title": "Bad", "md": ""},
            {"role": "general", "kind": "kb", "source": "manual", "title": "Good", "md": ""},
        ],
        "design_system": None,
    }
    resp = client.post("/projects/import/preview", json={"data": data, "target_project_id": None, "mode": "merge"})
    body = resp.json()
    assert body["valid"] is True
    assert body["counts"]["knowledge_total"] == 2
    assert body["counts"]["knowledge_valid"] == 1
    assert len(body["warnings"]) == 1
    assert body["plan"]["knowledge_create"] == 1


def test_preview_matches_import_counts_new_target(client):
    data = {
        "sethlans_export_version": 1,
        "project": {"name": "X", "md": "", "config": {}},
        "knowledge": [{"role": "general", "kind": "kb", "source": "manual", "title": "A", "md": ""}],
        "design_system": {"title": "DS", "md": None, "tokens": None, "components": None, "source": "code_scan"},
    }
    preview = client.post("/projects/import/preview", json={"data": data, "target_project_id": None, "mode": "merge"}).json()
    assert preview["plan"]["knowledge_create"] == 1
    assert preview["plan"]["design_system_action"] == "create"

    result = client.post("/projects/import", json={"data": data, "target_project_id": None, "mode": "merge"}).json()
    assert result["knowledge_created"] == 1
    assert result["design_system_action"] == "create"


# ---------- POST /projects/import — round-trip, merge, replace ----------

def test_roundtrip_export_import_new_project(client):
    source = _project(client, name="Source", md="# profilo sorgente", config={"a": 1})
    _knowledge(client, source["id"], title="Card A", role="seth-fullstack", kind="kb", md="contenuto A")
    _knowledge(client, source["id"], title="Card B", role="seth-frontend", kind="standards", md="contenuto B")
    _design_system(client, source["id"], title="DS Source", tokens='{"colors":{"--bg":"#000"}}')

    export = client.get(f"/projects/{source['id']}/export").json()

    result = client.post("/projects/import", json={"data": export, "target_project_id": None, "mode": "merge"}).json()
    assert result["knowledge_created"] == 2
    assert result["knowledge_updated"] == 0
    assert result["knowledge_skipped"] == 0
    assert result["profile_action"] == "set"
    assert result["design_system_action"] == "create"
    new_id = result["target_project_id"]
    assert new_id != source["id"]

    reexport = client.get(f"/projects/{new_id}/export").json()
    assert reexport["project"]["name"] == "Source"
    assert reexport["project"]["md"] == "# profilo sorgente"
    assert reexport["project"]["config"] == {"a": 1}
    assert sorted(c["title"] for c in reexport["knowledge"]) == ["Card A", "Card B"]
    assert reexport["design_system"]["title"] == "DS Source"


def test_merge_is_idempotent_no_duplicates(client):
    source = _project(client, name="Source")
    _knowledge(client, source["id"], title="Card A", role="general", kind="kb", md="v1")
    export = client.get(f"/projects/{source['id']}/export").json()

    target = _project(client, name="Target")
    r1 = client.post("/projects/import", json={"data": export, "target_project_id": target["id"], "mode": "merge"}).json()
    assert r1["knowledge_created"] == 1
    assert r1["knowledge_updated"] == 0

    # re-importa lo stesso export sullo stesso target: deve aggiornare, non duplicare
    r2 = client.post("/projects/import", json={"data": export, "target_project_id": target["id"], "mode": "merge"}).json()
    assert r2["knowledge_created"] == 0
    assert r2["knowledge_updated"] == 1

    listed = client.get(f"/knowledge?project_id={target['id']}").json()
    assert len(listed) == 1


def test_merge_keeps_profile_if_target_not_empty(client):
    source = _project(client, name="Source", md="# sorgente")
    export = client.get(f"/projects/{source['id']}/export").json()

    target = _project(client, name="Target", md="# esistente sul target")
    result = client.post("/projects/import", json={"data": export, "target_project_id": target["id"], "mode": "merge"}).json()
    assert result["profile_action"] == "kept"

    target_after = client.get(f"/projects/{target['id']}").json()
    assert target_after["md"] == "# esistente sul target"


def test_replace_wipes_and_reimports(client):
    source = _project(client, name="Source", md="# sorgente")
    _knowledge(client, source["id"], title="New Card", role="general", kind="kb")
    export = client.get(f"/projects/{source['id']}/export").json()

    target = _project(client, name="Target", md="# vecchio profilo")
    _knowledge(client, target["id"], title="Old Card", role="general", kind="kb")
    _design_system(client, target["id"], title="Old DS")

    result = client.post("/projects/import", json={"data": export, "target_project_id": target["id"], "mode": "replace"}).json()
    assert result["profile_action"] == "overwritten"
    assert result["knowledge_created"] == 1

    listed = client.get(f"/knowledge?project_id={target['id']}").json()
    assert len(listed) == 1
    assert listed[0]["title"] == "New Card"

    target_after = client.get(f"/projects/{target['id']}").json()
    assert target_after["md"] == "# sorgente"


def test_replace_with_existing_design_system_reports_replace_not_create(client):
    """Regressione BLOCKER (t381b4804): nel ramo replace, import_project cancellava
    il DesignSystem del target prima di ricalcolare existing_ds, quindi finiva
    sempre nel ramo "create" anche quando la preview prometteva "replace".
    preview.plan.design_system_action e result.design_system_action devono
    coincidere ed essere entrambi "replace" quando il target ha già un DS."""
    source = _project(client, name="Source")
    _design_system(client, source["id"], title="New DS")
    export = client.get(f"/projects/{source['id']}/export").json()

    target = _project(client, name="Target")
    _design_system(client, target["id"], title="Old DS")

    body = {"data": export, "target_project_id": target["id"], "mode": "replace"}

    preview = client.post("/projects/import/preview", json=body).json()
    assert preview["plan"]["design_system_action"] == "replace"

    result = client.post("/projects/import", json=body).json()
    assert result["design_system_action"] == "replace"
    assert preview["plan"]["design_system_action"] == result["design_system_action"]

    ds_after = client.get(f"/projects/{target['id']}/export").json()["design_system"]
    assert ds_after["title"] == "New DS"


def test_import_skips_invalid_enum_never_500(client):
    data = {
        "sethlans_export_version": 1,
        "project": {"name": "X", "md": "", "config": {}},
        "knowledge": [
            {"role": "qa-lead", "kind": "notes", "source": "manual", "title": "Bad", "md": ""},
            {"role": "general", "kind": "kb", "source": "manual", "title": "Good", "md": ""},
        ],
        "design_system": None,
    }
    resp = client.post("/projects/import", json={"data": data, "target_project_id": None, "mode": "merge"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["knowledge_created"] == 1
    assert body["knowledge_skipped"] == 1
    assert len(body["warnings"]) == 1


def test_import_target_missing_404(client):
    data = {"sethlans_export_version": 1, "project": {"name": "X"}, "knowledge": []}
    resp = client.post("/projects/import", json={"data": data, "target_project_id": "pnope", "mode": "merge"})
    assert resp.status_code == 404


def test_import_invalid_mode_422(client):
    data = {"sethlans_export_version": 1, "project": {"name": "X"}, "knowledge": []}
    resp = client.post("/projects/import", json={"data": data, "target_project_id": None, "mode": "bogus"})
    assert resp.status_code == 422


def test_import_malformed_envelope_422_not_500(client):
    resp = client.post(
        "/projects/import",
        json={"data": {"sethlans_export_version": 1, "knowledge": "not-a-list"}, "target_project_id": None, "mode": "merge"},
    )
    assert resp.status_code == 422
