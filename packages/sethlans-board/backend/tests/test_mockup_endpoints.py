"""Test unitari veloci per i campi derivati e gli endpoint /mockups, /mockup-comments.

Integrazione/E2E (Testcontainers, Postgres reale) sono a carico del seth-tester.
"""
import base64

MOCKUP_BLOCK = "```mockup\n<html><body>hi</body></html>\n```"


def _make_hierarchy(client, n_story_mockups=1, n_task_mockups=1):
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    story_md = "# Story heading\n\n" + (MOCKUP_BLOCK + "\n") * n_story_mockups
    story = client.post(
        "/stories", json={"title": "S", "epic_id": epic["id"], "md": story_md}
    ).json()
    task_md = "# Task heading\n\n" + (MOCKUP_BLOCK + "\n") * n_task_mockups
    task = client.post(
        "/tasks", json={"title": "T", "story_id": story["id"], "md": task_md}
    ).json()
    return project, epic, story, task


# ---------- Campi derivati (C0) ----------

def test_task_mockup_count_zero(client):
    project, epic, story, _ = _make_hierarchy(client, n_story_mockups=0, n_task_mockups=0)
    task = client.post("/tasks", json={"title": "T2", "story_id": story["id"], "md": "no mockup here"}).json()
    got = client.get(f"/tasks/{task['id']}").json()
    assert got["mockup_count"] == 0


def test_task_mockup_count_n(client):
    _, _, story, _ = _make_hierarchy(client, n_story_mockups=0, n_task_mockups=0)
    task = client.post(
        "/tasks", json={"title": "T3", "story_id": story["id"], "md": (MOCKUP_BLOCK + "\n") * 3}
    ).json()
    got = client.get(f"/tasks/{task['id']}").json()
    assert got["mockup_count"] == 3


def test_story_mockup_descendant_count_includes_tasks(client):
    _, _, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=2)
    got = client.get(f"/stories/{story['id']}").json()
    assert got["mockup_count"] == 1
    assert got["mockup_descendant_count"] == 3  # 1 (story) + 2 (task)


def test_epic_mockup_descendant_count_aggregates_stories_and_tasks(client):
    project, epic, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=2)
    got = client.get(f"/epics/{epic['id']}").json()
    assert got["mockup_descendant_count"] == 3


def test_epic_mockup_descendant_count_includes_own_md_without_stories(client):
    """Regressione t0bc30349/td5b0fd19: epic con blocco mockup nella propria md
    ma senza story discendenti deve contribuire al count, non restare a 0."""
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post(
        "/epics",
        json={"title": "E", "project_id": project["id"], "md": f"# Epic heading\n\n{MOCKUP_BLOCK}\n"},
    ).json()
    got = client.get(f"/epics/{epic['id']}").json()
    assert got["mockup_descendant_count"] == 1


def test_epic_mockup_descendant_count_sums_own_and_descendants(client):
    project, epic_dict, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=2)
    epic_md = f"# Epic heading\n\n{MOCKUP_BLOCK}\n"
    client.patch(f"/epics/{epic_dict['id']}", json={"md": epic_md})
    got = client.get(f"/epics/{epic_dict['id']}").json()
    assert got["mockup_descendant_count"] == 4  # 1 (epic) + 1 (story) + 2 (task)


def test_state_snapshot_exposes_mockup_comments_and_counts(client):
    _, epic, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=1)
    state = client.get("/state").json()
    assert "mockup_comments" in state
    story_in_state = next(s for s in state["stories"] if s["id"] == story["id"])
    assert story_in_state["mockup_descendant_count"] == 2


# ---------- GET /mockups ----------

def test_list_mockups_requires_exactly_one_filter(client):
    resp = client.get("/mockups")
    assert resp.status_code == 422
    resp = client.get("/mockups?story_id=s1&task_id=t1")
    assert resp.status_code == 422


def test_list_mockups_by_story_includes_descendant_tasks(client):
    _, _, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=2)
    resp = client.get(f"/mockups?story_id={story['id']}")
    assert resp.status_code == 200
    items = resp.json()["mockups"]
    assert len(items) == 3
    assert {i["target_type"] for i in items} == {"story", "task"}


def test_list_mockups_by_epic_aggregates_full_descendance(client):
    _, epic, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=1)
    resp = client.get(f"/mockups?epic_id={epic['id']}")
    items = resp.json()["mockups"]
    assert len(items) == 2


def test_list_mockups_by_epic_includes_own_md_without_stories(client):
    """Regressione t0bc30349/td5b0fd19: /mockups?epic_id= non deve restare vuoto
    quando l'epic ha un blocco mockup nella propria md e nessuna story."""
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post(
        "/epics",
        json={"title": "E", "project_id": project["id"], "md": f"# Epic heading\n\n{MOCKUP_BLOCK}\n"},
    ).json()
    resp = client.get(f"/mockups?epic_id={epic['id']}")
    assert resp.status_code == 200
    items = resp.json()["mockups"]
    assert len(items) == 1
    assert items[0]["target_type"] == "epic"
    assert items[0]["target_id"] == epic["id"]


def test_list_mockups_by_epic_includes_own_plus_descendants(client):
    project, epic_dict, story, task = _make_hierarchy(client, n_story_mockups=1, n_task_mockups=1)
    epic_md = f"# Epic heading\n\n{MOCKUP_BLOCK}\n"
    client.patch(f"/epics/{epic_dict['id']}", json={"md": epic_md})
    resp = client.get(f"/mockups?epic_id={epic_dict['id']}")
    items = resp.json()["mockups"]
    assert len(items) == 3
    assert {i["target_type"] for i in items} == {"epic", "story", "task"}


def test_list_mockups_unknown_target_is_404(client):
    resp = client.get("/mockups?story_id=snotfound")
    assert resp.status_code == 404


# ---------- POST /mockup-comments ----------

def test_create_comment_text_only(client):
    _, _, story, _ = _make_hierarchy(client)
    resp = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": story["id"], "mockup_index": 0, "text": "change this"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["text"] == "change this"
    assert body["image"] is None


def test_create_comment_invalid_target_type_422(client):
    _, _, story, _ = _make_hierarchy(client)
    resp = client.post(
        "/mockup-comments",
        json={"target_type": "epic", "target_id": story["id"], "mockup_index": 0, "text": "x"},
    )
    assert resp.status_code == 422


def test_create_comment_unknown_target_404(client):
    resp = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": "snotfound", "mockup_index": 0, "text": "x"},
    )
    assert resp.status_code == 404


def test_create_comment_empty_text_and_image_422(client):
    _, _, story, _ = _make_hierarchy(client)
    resp = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": story["id"], "mockup_index": 0, "text": ""},
    )
    assert resp.status_code == 422


def test_create_comment_image_bad_prefix_422(client):
    _, _, story, _ = _make_hierarchy(client)
    resp = client.post(
        "/mockup-comments",
        json={
            "target_type": "story", "target_id": story["id"], "mockup_index": 0,
            "image": "not-a-data-uri",
        },
    )
    assert resp.status_code == 422


def test_create_comment_image_oversize_422(client):
    _, _, story, _ = _make_hierarchy(client)
    big_payload = base64.b64encode(b"0" * (2 * 1024 * 1024 + 1)).decode()
    resp = client.post(
        "/mockup-comments",
        json={
            "target_type": "story", "target_id": story["id"], "mockup_index": 0,
            "image": f"data:image/png;base64,{big_payload}",
        },
    )
    assert resp.status_code == 422


def test_create_comment_image_valid_small(client):
    _, _, story, _ = _make_hierarchy(client)
    payload = base64.b64encode(b"tiny-image-bytes").decode()
    resp = client.post(
        "/mockup-comments",
        json={
            "target_type": "story", "target_id": story["id"], "mockup_index": 0,
            "image": f"data:image/png;base64,{payload}",
        },
    )
    assert resp.status_code == 201


# ---------- GET /mockup-comments ordering + DELETE ----------

def test_list_comments_ordered_by_created_at_asc(client):
    _, _, story, _ = _make_hierarchy(client)
    first = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": story["id"], "mockup_index": 0, "text": "first"},
    ).json()
    second = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": story["id"], "mockup_index": 0, "text": "second"},
    ).json()
    resp = client.get(f"/mockup-comments?target_type=story&target_id={story['id']}&mockup_index=0")
    items = resp.json()
    assert [i["id"] for i in items] == [first["id"], second["id"]]


def test_delete_comment_then_404(client):
    _, _, story, _ = _make_hierarchy(client)
    comment = client.post(
        "/mockup-comments",
        json={"target_type": "story", "target_id": story["id"], "mockup_index": 0, "text": "x"},
    ).json()
    resp = client.delete(f"/mockup-comments/{comment['id']}")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": comment["id"]}
    resp = client.delete(f"/mockup-comments/{comment['id']}")
    assert resp.status_code == 404
