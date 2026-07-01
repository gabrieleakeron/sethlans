"""Test unitari per l'endpoint `GET /stories/{story_id}/agent-tokens` (story
`s36b99979`): token per-storia aggregati per agent via SUM(Task.tokens)
GROUP BY Task.agent_id. Integrazione/E2E sono a carico del seth-tester.
"""


def _project_epic_story(client, title="S"):
    project = client.post("/projects", json={"name": "P"}).json()
    epic = client.post("/epics", json={"title": "E", "project_id": project["id"]}).json()
    story = client.post("/stories", json={"title": title, "epic_id": epic["id"]}).json()
    return project, epic, story


def _agent(client, name):
    return client.post("/agents", json={"name": name}).json()


def _task(client, story_id, agent_id=None, tokens=0, title="T"):
    return client.post(
        "/tasks",
        json={"title": title, "story_id": story_id, "agent_id": agent_id, "tokens": tokens},
    ).json()


# ---------- GET /stories/{id}/agent-tokens ----------

def test_agent_tokens_unknown_story_404(client):
    resp = client.get("/stories/snotfound/agent-tokens")
    assert resp.status_code == 404


def test_agent_tokens_empty_story(client):
    _, _, story = _project_epic_story(client)
    resp = client.get(f"/stories/{story['id']}/agent-tokens")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"story_id": story["id"], "total_tokens": 0, "agents": []}


def test_agent_tokens_aggregates_per_agent_excludes_null_agent(client):
    _, _, story = _project_epic_story(client)
    a1 = _agent(client, "seth-frontend")
    a2 = _agent(client, "seth-be-python")

    _task(client, story["id"], agent_id=a1["id"], tokens=10_000, title="T1")
    _task(client, story["id"], agent_id=a1["id"], tokens=16_000, title="T2")
    _task(client, story["id"], agent_id=a2["id"], tokens=5_000, title="T3")
    # task senza agent_id: escluso dall'aggregazione
    _task(client, story["id"], agent_id=None, tokens=999_999, title="T4-unassigned")

    resp = client.get(f"/stories/{story['id']}/agent-tokens")
    assert resp.status_code == 200
    body = resp.json()
    assert body["story_id"] == story["id"]
    assert body["total_tokens"] == 31_000

    by_name = {a["name"]: a for a in body["agents"]}
    assert set(by_name) == {"seth-frontend", "seth-be-python"}
    assert by_name["seth-frontend"]["story_tokens"] == 26_000
    assert by_name["seth-be-python"]["story_tokens"] == 5_000
    # tokens = cumulativo globale dell'agent (0 di default, non toccato da questo endpoint)
    assert by_name["seth-frontend"]["tokens"] == 0
    assert by_name["seth-frontend"]["agent_id"] == a1["id"]
    assert by_name["seth-frontend"]["status"] == "idle"
    assert by_name["seth-frontend"]["current_task"] == "Inattivo"

    # ordinamento: story_tokens DESC
    assert [a["name"] for a in body["agents"]] == ["seth-frontend", "seth-be-python"]


def test_agent_tokens_only_this_story(client):
    """I task di un'altra storia non devono contaminare l'aggregazione."""
    _, epic, story1 = _project_epic_story(client, title="S1")
    story2 = client.post("/stories", json={"title": "S2", "epic_id": epic["id"]}).json()
    agent = _agent(client, "seth-fullstack")

    _task(client, story1["id"], agent_id=agent["id"], tokens=1_000)
    _task(client, story2["id"], agent_id=agent["id"], tokens=50_000)

    body = client.get(f"/stories/{story1['id']}/agent-tokens").json()
    assert body["total_tokens"] == 1_000
    assert len(body["agents"]) == 1
    assert body["agents"][0]["story_tokens"] == 1_000


def test_agent_tokens_tie_break_by_name_asc(client):
    _, _, story = _project_epic_story(client)
    a_b = _agent(client, "seth-b")
    a_a = _agent(client, "seth-a")
    _task(client, story["id"], agent_id=a_b["id"], tokens=100, title="Tb")
    _task(client, story["id"], agent_id=a_a["id"], tokens=100, title="Ta")

    body = client.get(f"/stories/{story['id']}/agent-tokens").json()
    assert [a["name"] for a in body["agents"]] == ["seth-a", "seth-b"]


def test_task_to_dict_includes_tokens(client):
    _, _, story = _project_epic_story(client)
    task = client.post(
        "/tasks", json={"title": "T", "story_id": story["id"], "tokens": 42}
    ).json()
    assert task["tokens"] == 42
    got = client.get(f"/tasks/{task['id']}").json()
    assert got["tokens"] == 42


def test_task_default_tokens_zero(client):
    _, _, story = _project_epic_story(client)
    task = client.post("/tasks", json={"title": "T", "story_id": story["id"]}).json()
    assert task["tokens"] == 0
