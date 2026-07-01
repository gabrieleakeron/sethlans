"""Test unitari per il `kind` delle knowledge card (task `t3e68b0ba`): verifica
che `kind=standards` (Definition of Done per-ruolo) sia accettato da
`POST /knowledge` e che un `kind` non valido resti rifiutato con 422.
Integrazione/E2E sono a carico del seth-tester.
"""


def _project(client, name="P"):
    return client.post("/projects", json={"name": name}).json()


def test_create_knowledge_kind_standards_ok(client):
    project = _project(client)
    resp = client.post(
        "/knowledge",
        json={
            "project_id": project["id"],
            "title": "Definition of Done — seth-fullstack",
            "role": "seth-fullstack",
            "kind": "standards",
            "source": "manual",
            "md": "# DoD\n- contratto FE/BE scritto prima del codice\n",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "standards"
    assert body["role"] == "seth-fullstack"
    assert body["id"].startswith("k")


def test_create_knowledge_invalid_kind_422(client):
    project = _project(client)
    resp = client.post(
        "/knowledge",
        json={
            "project_id": project["id"],
            "title": "Bad kind",
            "role": "seth-fullstack",
            "kind": "bogus",
            "source": "manual",
        },
    )
    assert resp.status_code == 422


def test_patch_knowledge_kind_standards_ok(client):
    project = _project(client)
    created = client.post(
        "/knowledge",
        json={
            "project_id": project["id"],
            "title": "KB card",
            "role": "seth-fullstack",
            "kind": "kb",
            "source": "manual",
        },
    ).json()

    resp = client.patch(f"/knowledge/{created['id']}", json={"kind": "standards"})
    assert resp.status_code == 200
    assert resp.json()["kind"] == "standards"


def test_patch_knowledge_invalid_kind_422(client):
    project = _project(client)
    created = client.post(
        "/knowledge",
        json={
            "project_id": project["id"],
            "title": "KB card",
            "role": "seth-fullstack",
            "kind": "kb",
            "source": "manual",
        },
    ).json()

    resp = client.patch(f"/knowledge/{created['id']}", json={"kind": "bogus"})
    assert resp.status_code == 422
