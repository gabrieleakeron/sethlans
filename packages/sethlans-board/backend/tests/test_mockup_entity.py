"""Test unitari per l'entità Mockup di prima classe (story `s443652b6`):
modello/endpoint CRUD `/mockups`, retrocompat `GET /mockups`, `POST /mockup-comments`
con `mockup_id`. Integrazione/E2E (Testcontainers, Postgres reale) sono a carico
del seth-tester.
"""


def _project_epic_story_task(client):
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    story = client.post("/stories", json={"title": "S", "epic_id": epic["id"]}).json()
    task = client.post("/tasks", json={"title": "T", "story_id": story["id"]}).json()
    return project, epic, story, task


# ---------- POST /mockups ----------

def test_create_mockup_html_default(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "M1", "content": "<html></html>"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["owner_type"] == "story"
    assert body["owner_id"] == story["id"]
    assert body["type"] == "html"
    assert body["source"] == "embedded"
    assert body["position"] == 0
    assert body["id"].startswith("mk")


def test_create_mockup_task_owner(client):
    _, _, _, task = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={"owner_type": "task", "owner_id": task["id"], "title": "M-task"},
    )
    assert resp.status_code == 201
    assert resp.json()["owner_type"] == "task"


def test_create_mockup_invalid_owner_type_422(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={"owner_type": "epic", "owner_id": story["id"], "title": "X"},
    )
    assert resp.status_code == 422


def test_create_mockup_invalid_type_422(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "X", "type": "bogus"},
    )
    assert resp.status_code == 422


def test_create_mockup_unknown_owner_404(client):
    resp = client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": "snotfound", "title": "X"},
    )
    assert resp.status_code == 404


def test_create_mockup_figma_requires_ref_url(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "Figma", "type": "figma", "source": "figma"},
    )
    assert resp.status_code == 422


def test_create_mockup_figma_with_ref_url_ok(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={
            "owner_type": "story", "owner_id": story["id"], "title": "Figma",
            "type": "figma", "source": "figma", "ref_url": "https://figma.com/x",
        },
    )
    assert resp.status_code == 201


def test_create_mockup_type_source_mismatch_422(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockups",
        json={"owner_type": "story", "owner_id": story["id"], "title": "X", "type": "html", "source": "upload"},
    )
    assert resp.status_code == 422


# ---------- GET /mockups/{id}, PATCH, DELETE ----------

def test_get_mockup_by_id(client):
    _, _, story, _ = _project_epic_story_task(client)
    created = client.post(
        "/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"}
    ).json()
    got = client.get(f"/mockups/{created['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == created["id"]


def test_get_mockup_unknown_404(client):
    resp = client.get("/mockups/mknotfound")
    assert resp.status_code == 404


def test_patch_mockup_updates_fields_and_timestamp(client):
    _, _, story, _ = _project_epic_story_task(client)
    created = client.post(
        "/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"}
    ).json()
    resp = client.patch(f"/mockups/{created['id']}", json={"title": "M1 renamed"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "M1 renamed"
    assert body["updated_at"] >= created["updated_at"]


def test_patch_mockup_invalid_type_422(client):
    _, _, story, _ = _project_epic_story_task(client)
    created = client.post(
        "/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"}
    ).json()
    resp = client.patch(f"/mockups/{created['id']}", json={"type": "bogus"})
    assert resp.status_code == 422


def test_delete_mockup_then_404(client):
    _, _, story, _ = _project_epic_story_task(client)
    created = client.post(
        "/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"}
    ).json()
    resp = client.delete(f"/mockups/{created['id']}")
    assert resp.status_code == 200
    resp = client.get(f"/mockups/{created['id']}")
    assert resp.status_code == 404


# ---------- GET /mockups retrocompat (owner_type/owner_id + legacy story_id/task_id) ----------

def test_list_mockups_by_owner_type_and_id(client):
    _, _, story, _ = _project_epic_story_task(client)
    client.post("/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"})
    client.post("/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M2", "position": 1})
    resp = client.get(f"/mockups?owner_type=story&owner_id={story['id']}")
    assert resp.status_code == 200
    items = resp.json()["mockups"]
    assert len(items) == 2
    assert items[0]["position"] == 0 and items[1]["position"] == 1


def test_list_mockups_owner_requires_both_params(client):
    resp = client.get("/mockups?owner_type=story")
    assert resp.status_code == 422


def test_list_mockups_owner_and_legacy_filters_conflict(client):
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.get(f"/mockups?owner_type=story&owner_id={story['id']}&story_id={story['id']}")
    assert resp.status_code == 422


def test_list_mockups_legacy_story_id_aggregates_entity_rows(client):
    _, _, story, task = _project_epic_story_task(client)
    client.post("/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M-story"})
    client.post("/mockups", json={"owner_type": "task", "owner_id": task["id"], "title": "M-task"})
    resp = client.get(f"/mockups?story_id={story['id']}")
    assert resp.status_code == 200
    items = resp.json()["mockups"]
    assert len(items) == 2
    assert {i["owner_type"] for i in items} == {"story", "task"}


def test_list_mockups_legacy_md_fallback_when_no_entity_rows(client):
    """Owner senza righe Mockup persistite: fallback sui blocchi del md (pre-backfill)."""
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    md = "# Heading\n\n```mockup\n<html></html>\n```\n"
    story = client.post("/stories", json={"title": "S", "epic_id": epic["id"], "md": md}).json()
    resp = client.get(f"/mockups?story_id={story['id']}")
    items = resp.json()["mockups"]
    assert len(items) == 1
    assert items[0]["target_type"] == "story"  # forma legacy (fallback), non l'entità


def test_list_mockups_entity_rows_take_precedence_over_md_fallback(client):
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    md = "```mockup\n<html></html>\n```\n"
    story = client.post("/stories", json={"title": "S", "epic_id": epic["id"], "md": md}).json()
    # Una volta backfillato/creato un Mockup per questo owner, la lista usa SOLO l'entità.
    client.post("/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "Migrated"})
    resp = client.get(f"/mockups?story_id={story['id']}")
    items = resp.json()["mockups"]
    assert len(items) == 1
    assert items[0]["title"] == "Migrated"


# ---------- POST /mockup-comments con mockup_id ----------

def test_create_comment_with_mockup_id(client):
    _, _, story, _ = _project_epic_story_task(client)
    mockup = client.post(
        "/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"}
    ).json()
    resp = client.post(
        "/mockup-comments", json={"mockup_id": mockup["id"], "text": "looks good"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["mockup_id"] == mockup["id"]


def test_create_comment_unknown_mockup_id_404(client):
    resp = client.post("/mockup-comments", json={"mockup_id": "mknotfound", "text": "x"})
    assert resp.status_code == 404


def test_create_comment_neither_mockup_id_nor_legacy_422(client):
    resp = client.post("/mockup-comments", json={"text": "x"})
    assert resp.status_code == 422


def test_create_comment_legacy_still_works(client):
    """Retrocompat: target_type/target_id/mockup_index continuano a funzionare."""
    _, _, story, _ = _project_epic_story_task(client)
    resp = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": story["id"], "mockup_index": 0, "text": "legacy"},
    )
    assert resp.status_code == 201
    assert resp.json()["mockup_id"] is None


def test_list_comments_by_mockup_id(client):
    _, _, story, _ = _project_epic_story_task(client)
    mockup = client.post(
        "/mockups", json={"owner_type": "story", "owner_id": story["id"], "title": "M1"}
    ).json()
    client.post("/mockup-comments", json={"mockup_id": mockup["id"], "text": "c1"})
    resp = client.get(f"/mockup-comments?mockup_id={mockup['id']}")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["text"] == "c1"
