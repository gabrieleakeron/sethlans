"""
Sethlans Board — Backend API
==============================
Server CRUD per epiche, storie, task e agenti. Chiamabile dall'interfaccia
Sethlans Board e dai subagenti di Claude.

Persistenza: SQLite (default) o Postgres (schema `sethlans_service`) via SQLAlchemy. Le
tabelle sono gestite con Alembic — prima dell'avvio eseguire:
    pip install -r requirements.txt
    alembic upgrade head
    python server.py
Docs interattive: http://localhost:9955/docs

Connessione: env `SETHLANS_SERVICE_DB_URL` (vedi db.py). Porta: env `SETHLANS_SERVICE_PORT` (default 9955).

Caratteristiche del modello dati:
- ogni entità (epic/story/task) ha un campo `md` (+ `md_updated_at`) per il
  documento Markdown associato;
- le storie hanno una `phase` (analysis|ux|design|dev|done) per il flusso PO→UX→architect→dev.
"""

import base64
import hmac
import os
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from db import SessionLocal
from models import (
    DESIGN_PROVIDER,
    DESIGN_SOURCE,
    DESIGN_SYNC_STATE,
    KIND_KNOWLEDGE,
    MOCKUP_OWNER,
    MOCKUP_SOURCE,
    MOCKUP_TYPE,
    PHASE_STORY,
    ROLE_KNOWLEDGE,
    SOURCE_KNOWLEDGE,
    STATUS_AGENT,
    STATUS_WORK,
    TARGET_COMMENT,
    TYPE_PROJECT,
    Agent,
    DesignSystem,
    Epic,
    Knowledge,
    Mockup,
    MockupComment,
    Project,
    Story,
    Task,
    count_mockups,
    iter_mockup_blocks,
    new_id,
)

# Limite immagini commento (D2): ~2MB decodificati dal base64 della data URI.
MAX_COMMENT_IMAGE_BYTES = 2 * 1024 * 1024
DATA_URI_IMAGE_PREFIX_RE = re.compile(r"^data:image/[a-zA-Z0-9.+-]+;base64,")

# ----------------------------- Schemi (API contract) -----------------------------


class ProjectIn(BaseModel):
    name: str
    type: str = "internal"
    jira_key: str = ""
    md: str = ""
    config: dict = {}

class ProjectPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    jira_key: Optional[str] = None
    md: Optional[str] = None
    config: Optional[dict] = None


class KnowledgeIn(BaseModel):
    project_id: str
    title: str
    role: str = "general"
    kind: str = "kb"
    source: str = "manual"
    md: str = ""

class KnowledgePatch(BaseModel):
    title: Optional[str] = None
    role: Optional[str] = None
    kind: Optional[str] = None
    source: Optional[str] = None
    md: Optional[str] = None


class EpicIn(BaseModel):
    title: str
    desc: str = ""
    status: str = "todo"
    project_id: str
    md: str = ""

class EpicPatch(BaseModel):
    title: Optional[str] = None
    desc: Optional[str] = None
    status: Optional[str] = None
    project_id: Optional[str] = None
    md: Optional[str] = None


class StoryIn(BaseModel):
    title: str
    desc: str = ""
    status: str = "todo"
    phase: str = "analysis"
    epic_id: str
    md: str = ""

class StoryPatch(BaseModel):
    title: Optional[str] = None
    desc: Optional[str] = None
    status: Optional[str] = None
    phase: Optional[str] = None
    epic_id: Optional[str] = None
    md: Optional[str] = None


class StoryAgentTokens(BaseModel):
    """Riga di aggregazione per un singolo agente nell'endpoint agent-tokens (story `s36b99979`)."""
    agent_id: str
    name: str
    status: str
    current_task: str
    story_tokens: int
    tokens: int

class StoryAgentTokensOut(BaseModel):
    """Response di `GET /stories/{story_id}/agent-tokens`: token per-storia aggregati per agent."""
    story_id: str
    total_tokens: int
    agents: list[StoryAgentTokens]


class TaskIn(BaseModel):
    title: str
    status: str = "todo"
    story_id: str
    agent_id: Optional[str] = None
    md: str = ""
    tokens: int = 0

class TaskPatch(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    story_id: Optional[str] = None
    agent_id: Optional[str] = None
    md: Optional[str] = None
    tokens: Optional[int] = None


class AgentIn(BaseModel):
    name: str
    current_task: str = "Inattivo"
    status: str = "idle"
    tokens: int = 0

class AgentPatch(BaseModel):
    name: Optional[str] = None
    current_task: Optional[str] = None
    status: Optional[str] = None
    tokens: Optional[int] = None


class MockupIn(BaseModel):
    owner_type: str
    owner_id: str
    title: str
    type: str = "html"
    source: str = "embedded"
    content: Optional[str] = None
    ref_url: Optional[str] = None
    position: int = 0

class MockupPatch(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    source: Optional[str] = None
    content: Optional[str] = None
    ref_url: Optional[str] = None
    position: Optional[int] = None


class MockupCommentIn(BaseModel):
    # Preferito (story s443652b6): FK applicativa verso l'entità Mockup.
    mockup_id: Optional[str] = None
    # Legacy: target polimorfico posizionale, retrocompat in transizione.
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    mockup_index: Optional[int] = None
    author: str = "user"
    text: str = ""
    image: Optional[str] = None


class DesignSystemIn(BaseModel):
    project_id: str
    title: str = "Design System"
    md: Optional[str] = None
    tokens: Optional[str] = None
    components: Optional[str] = None
    source: str = "code_scan"
    sync_state: str = "local"
    ext_provider: Optional[str] = None
    ext_file_id: Optional[str] = None
    ext_url: Optional[str] = None
    last_scan_at: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None

class DesignSystemPatch(BaseModel):
    title: Optional[str] = None
    md: Optional[str] = None
    tokens: Optional[str] = None
    components: Optional[str] = None
    source: Optional[str] = None
    sync_state: Optional[str] = None
    ext_provider: Optional[str] = None
    ext_file_id: Optional[str] = None
    ext_url: Optional[str] = None
    last_scan_at: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None


# ----------------------------- App -----------------------------

app = FastAPI(title="Sethlans Board API", version="2.0")

# Origini consentite: lista separata da virgole in SETHLANS_SERVICE_CORS_ORIGINS
# (es. "https://board.miodominio.it"); default "*" per compatibilità con lo
# sviluppo locale (docker-compose).
_cors_origins_env = os.environ.get("SETHLANS_SERVICE_CORS_ORIGINS", "*")
_cors_origins = (
    ["*"] if _cors_origins_env == "*" else [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    # Necessario perché il browser deve inviare il cookie CF_Authorization
    # (Cloudflare Access) cross-origin verso questo backend. Richiede
    # allow_origins esplicito: non è compatibile con "*" (vincolo CORS spec).
    allow_credentials=_cors_origins != ["*"],
)

# Token condiviso opzionale per proteggere la board quando esposta in rete
# (storia preview-shared-token, contratto auth in s69413e22). Letto a livello
# di modulo come _cors_origins. Se non settato: nessuna auth, comportamento
# invariato (retro-compatibile per lo sviluppo locale).
_api_token = os.environ.get("SETHLANS_SERVICE_API_TOKEN", "").strip()


@app.middleware("http")
async def _auth_token_middleware(request: Request, call_next):
    """Verifica l'header X-Sethlans-Token quando SETHLANS_SERVICE_API_TOKEN è settato.

    Registrato DOPO il CORSMiddleware: in Starlette l'ultimo middleware aggiunto è
    il più esterno, quindi questo auth-middleware avvolge il CORS ed è invocato per
    primo. L'OPTIONS viene escluso esplicitamente qui sotto, così il preflight CORS
    (che non porta header custom) passa indenne fino al CORSMiddleware. Confronto a
    tempo costante per evitare leak via timing; il messaggio d'errore è generico e
    non espone mai il token atteso né lo registra nei log.
    """
    if not _api_token:
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    # Confronto su bytes: gli header Starlette sono decodificati latin-1, quindi un
    # token con byte non-ASCII darebbe una str che farebbe sollevare TypeError a
    # compare_digest (→ 500). Codificando entrambi gli operandi in utf-8 il mismatch
    # diventa un normale 401, in parità col lato Node (crypto.timingSafeEqual su buffer).
    token_ricevuto = request.headers.get("x-sethlans-token", "")
    if not hmac.compare_digest(token_ricevuto.encode("utf-8"), _api_token.encode("utf-8")):
        return JSONResponse(status_code=401, content={"detail": "token mancante o non valido"})
    return await call_next(request)


def get_db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


# ----------------------------- Helpers -----------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def validate_status(value, allowed, field="status"):
    if value is not None and value not in allowed:
        raise HTTPException(422, f"{field} non valido: deve essere uno tra {sorted(allowed)}")


def fetch_or_404(db: Session, model, _id: str):
    obj = db.get(model, _id)
    if not obj:
        raise HTTPException(404, f"{model.__tablename__[:-1]} '{_id}' non trovato")
    return obj


def apply_md_timestamp(obj, patch_dict):
    """Se l'MD viene modificato, aggiorna md_updated_at."""
    if patch_dict.get("md") is not None and hasattr(obj, "md_updated_at"):
        obj.md_updated_at = _now()


# ---------- Helper conteggi mockup derivati (C0, D3) ----------
# Calcolati in memoria a partire dai dati già caricati, per evitare query N+1.


def _entity_mockup_counts(db: Session) -> dict[tuple[str, str], int]:
    """Carica in una sola query il numero di righe Mockup per ogni (owner_type, owner_id).

    Ritorna un dict {(owner_type, owner_id): n} usato da tutti i call site di
    serializzazione per evitare query N+1 (una query sola per intera richiesta).
    """
    rows = (
        db.query(Mockup.owner_type, Mockup.owner_id, func.count())
        .group_by(Mockup.owner_type, Mockup.owner_id)
        .all()
    )
    return {(ot, oid): n for ot, oid, n in rows}


def _owner_mockup_count(
    entity_counts: dict[tuple[str, str], int], owner_type: str, owner_obj
) -> int:
    """Conteggio mockup per un singolo owner, coerente con _mockups_for_owner.

    Se l'owner ha righe nella tabella mockups → restituisce quel numero.
    Altrimenti → fallback sui blocchi ```mockup``` nel campo md (legacy pre-backfill).
    Non somma mai entrambi: evita il doppio conteggio su owner già parzialmente migrati.
    """
    n = entity_counts.get((owner_type, owner_obj.id), 0)
    return n if n > 0 else count_mockups(owner_obj.md)


def _story_mockup_descendant_count(
    story: Story, tasks: list[Task], entity_counts: dict[tuple[str, str], int]
) -> int:
    """Totale mockup della story (propri + task discendenti), usando entity_counts."""
    return _owner_mockup_count(entity_counts, "story", story) + sum(
        _owner_mockup_count(entity_counts, "task", t) for t in tasks
    )


def _epic_mockup_descendant_count(
    epic: Epic,
    stories: list[Story],
    tasks_by_story: dict[str, list[Task]],
    entity_counts: dict[tuple[str, str], int],
) -> int:
    """Totale mockup dell'epic (propri + story + task discendenti), usando entity_counts.

    L'epic stesso non ha righe nella tabella mockups (MOCKUP_OWNER non include "epic"),
    quindi per la quota propria dell'epic si usa sempre il fallback legacy count_mockups(md).
    """
    total = count_mockups(epic.md)
    for s in stories:
        total += _story_mockup_descendant_count(s, tasks_by_story.get(s.id, []), entity_counts)
    return total


def _story_to_dict(db: Session, story: Story, entity_counts: dict[tuple[str, str], int] | None = None) -> dict:
    """Serializza una Story con mockup_count e mockup_descendant_count aggiornati.

    Se entity_counts non è fornito, lo calcola dalla DB (utile per i singoli GET).
    Nei list endpoint e in /state è preferibile passarlo già calcolato (una sola query).
    """
    if entity_counts is None:
        entity_counts = _entity_mockup_counts(db)
    tasks = db.query(Task).filter(Task.story_id == story.id).all()
    own = _owner_mockup_count(entity_counts, "story", story)
    return story.to_dict(
        mockup_count=own,
        mockup_descendant_count=_story_mockup_descendant_count(story, tasks, entity_counts),
    )


def _epic_to_dict(db: Session, epic: Epic, entity_counts: dict[tuple[str, str], int] | None = None) -> dict:
    """Serializza un Epic con mockup_descendant_count aggiornato.

    Se entity_counts non è fornito, lo calcola dalla DB (utile per i singoli GET).
    """
    if entity_counts is None:
        entity_counts = _entity_mockup_counts(db)
    stories = db.query(Story).filter(Story.epic_id == epic.id).all()
    story_ids = [s.id for s in stories]
    tasks_by_story: dict[str, list[Task]] = {sid: [] for sid in story_ids}
    if story_ids:
        for t in db.query(Task).filter(Task.story_id.in_(story_ids)).all():
            tasks_by_story.setdefault(t.story_id, []).append(t)
    return epic.to_dict(
        mockup_descendant_count=_epic_mockup_descendant_count(epic, stories, tasks_by_story, entity_counts)
    )


# ---------- PROJECTS ----------

@app.get("/projects")
def list_projects(type: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Project)
    if type:
        q = q.filter(Project.type == type)
    return [p.to_dict() for p in q.all()]

@app.post("/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    validate_status(body.type, TYPE_PROJECT, field="type")
    project = Project(
        id=new_id("p"), name=body.name, type=body.type, jira_key=body.jira_key,
        md=body.md, config=body.config or {},
        md_updated_at=_now() if body.md else None,
    )
    db.add(project); db.commit()
    return project.to_dict()

@app.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    return fetch_or_404(db, Project, project_id).to_dict()

@app.patch("/projects/{project_id}")
def update_project(project_id: str, body: ProjectPatch, db: Session = Depends(get_db)):
    validate_status(body.type, TYPE_PROJECT, field="type")
    project = fetch_or_404(db, Project, project_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    apply_md_timestamp(project, data)
    for k, v in data.items():
        setattr(project, k, v)
    db.commit()
    return project.to_dict()

@app.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Project, project_id)); db.commit()
    return {"deleted": project_id}


# ---------- EPICS ----------

@app.get("/epics")
def list_epics(status: Optional[str] = None, project_id: Optional[str] = None,
               db: Session = Depends(get_db)):
    q = db.query(Epic)
    if status:
        q = q.filter(Epic.status == status)
    if project_id:
        q = q.filter(Epic.project_id == project_id)
    # Calcola entity_counts una volta sola per evitare N query sul list
    ec = _entity_mockup_counts(db)
    return [_epic_to_dict(db, e, entity_counts=ec) for e in q.all()]

@app.post("/epics", status_code=201)
def create_epic(body: EpicIn, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_WORK)
    fetch_or_404(db, Project, body.project_id)
    epic = Epic(
        id=new_id("e"), title=body.title, desc=body.desc, status=body.status,
        project_id=body.project_id, md=body.md,
        md_updated_at=_now() if body.md else None,
    )
    db.add(epic); db.commit()
    return _epic_to_dict(db, epic)

@app.get("/epics/{epic_id}")
def get_epic(epic_id: str, db: Session = Depends(get_db)):
    return _epic_to_dict(db, fetch_or_404(db, Epic, epic_id))

@app.patch("/epics/{epic_id}")
def update_epic(epic_id: str, body: EpicPatch, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_WORK)
    epic = fetch_or_404(db, Epic, epic_id)
    if body.project_id is not None:
        fetch_or_404(db, Project, body.project_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    apply_md_timestamp(epic, data)
    for k, v in data.items():
        setattr(epic, k, v)
    db.commit()
    return _epic_to_dict(db, epic)

@app.delete("/epics/{epic_id}")
def delete_epic(epic_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Epic, epic_id)); db.commit()
    return {"deleted": epic_id}


# ---------- STORIES ----------

@app.get("/stories")
def list_stories(epic_id: Optional[str] = None, status: Optional[str] = None,
                 phase: Optional[str] = None, project_id: Optional[str] = None,
                 db: Session = Depends(get_db)):
    q = db.query(Story)
    if epic_id:
        q = q.filter(Story.epic_id == epic_id)
    if project_id:
        # stories of a project = stories whose epic belongs to that project
        q = q.join(Epic, Story.epic_id == Epic.id).filter(Epic.project_id == project_id)
    if status:
        q = q.filter(Story.status == status)
    if phase:
        q = q.filter(Story.phase == phase)
    # Calcola entity_counts una volta sola per evitare N query sul list
    ec = _entity_mockup_counts(db)
    return [_story_to_dict(db, s, entity_counts=ec) for s in q.all()]

@app.post("/stories", status_code=201)
def create_story(body: StoryIn, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_WORK)
    validate_status(body.phase, PHASE_STORY, field="phase")
    fetch_or_404(db, Epic, body.epic_id)
    story = Story(
        id=new_id("s"), title=body.title, desc=body.desc, status=body.status,
        phase=body.phase, epic_id=body.epic_id, md=body.md,
        md_updated_at=_now() if body.md else None,
    )
    db.add(story); db.commit()
    # Dopo la creazione non ci sono ancora righe entità Mockup: il fallback legacy è corretto.
    # Usiamo _story_to_dict per coerenza con gli altri endpoint.
    return _story_to_dict(db, story)

@app.get("/stories/{story_id}")
def get_story(story_id: str, db: Session = Depends(get_db)):
    return _story_to_dict(db, fetch_or_404(db, Story, story_id))

@app.patch("/stories/{story_id}")
def update_story(story_id: str, body: StoryPatch, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_WORK)
    validate_status(body.phase, PHASE_STORY, field="phase")
    story = fetch_or_404(db, Story, story_id)
    if body.epic_id is not None:
        fetch_or_404(db, Epic, body.epic_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    apply_md_timestamp(story, data)
    for k, v in data.items():
        setattr(story, k, v)
    db.commit()
    return _story_to_dict(db, story)

@app.delete("/stories/{story_id}")
def delete_story(story_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Story, story_id)); db.commit()
    return {"deleted": story_id}


@app.get("/stories/{story_id}/agent-tokens", response_model=StoryAgentTokensOut)
def get_story_agent_tokens(story_id: str, db: Session = Depends(get_db)):
    """Token consumati per QUESTA storia, aggregati per agent (story `s36b99979`).

    Aggregazione `SUM(Task.tokens) GROUP BY Task.agent_id` sui task della storia
    (una sola query, niente N+1), join su Agent per name/status/current_task.
    Task con `agent_id IS NULL` sono esclusi dall'aggregazione. `tokens` nella
    riga è il cumulativo GLOBALE dell'agent (invariato), `story_tokens` è la
    somma limitata a questa storia. Ordinamento: story_tokens DESC, name ASC.
    """
    fetch_or_404(db, Story, story_id)
    rows = (
        db.query(
            Agent.id, Agent.name, Agent.status, Agent.current_task, Agent.tokens,
            func.sum(Task.tokens).label("story_tokens"),
        )
        .join(Task, Task.agent_id == Agent.id)
        .filter(Task.story_id == story_id, Task.agent_id.isnot(None))
        .group_by(Agent.id, Agent.name, Agent.status, Agent.current_task, Agent.tokens)
        .order_by(func.sum(Task.tokens).desc(), Agent.name.asc())
        .all()
    )
    agents = [
        StoryAgentTokens(
            agent_id=agent_id, name=name, status=status, current_task=current_task,
            story_tokens=int(story_tokens or 0), tokens=tokens,
        )
        for agent_id, name, status, current_task, tokens, story_tokens in rows
    ]
    total_tokens = sum(a.story_tokens for a in agents)
    return StoryAgentTokensOut(story_id=story_id, total_tokens=total_tokens, agents=agents)


# ---------- TASKS ----------

@app.get("/tasks")
def list_tasks(story_id: Optional[str] = None, status: Optional[str] = None,
               agent_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Task)
    if story_id:
        q = q.filter(Task.story_id == story_id)
    if status:
        q = q.filter(Task.status == status)
    if agent_id:
        q = q.filter(Task.agent_id == agent_id)
    # Calcola entity_counts una volta sola per evitare N query sul list
    ec = _entity_mockup_counts(db)
    return [t.to_dict(mockup_count=_owner_mockup_count(ec, "task", t)) for t in q.all()]

@app.post("/tasks", status_code=201)
def create_task(body: TaskIn, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_WORK)
    fetch_or_404(db, Story, body.story_id)
    if body.agent_id:
        fetch_or_404(db, Agent, body.agent_id)
    task = Task(
        id=new_id("t"), title=body.title, status=body.status, story_id=body.story_id,
        agent_id=body.agent_id, md=body.md, md_updated_at=_now() if body.md else None,
        tokens=body.tokens,
    )
    db.add(task); db.commit()
    ec = _entity_mockup_counts(db)
    return task.to_dict(mockup_count=_owner_mockup_count(ec, "task", task))

@app.get("/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = fetch_or_404(db, Task, task_id)
    ec = _entity_mockup_counts(db)
    return task.to_dict(mockup_count=_owner_mockup_count(ec, "task", task))

@app.patch("/tasks/{task_id}")
def update_task(task_id: str, body: TaskPatch, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_WORK)
    task = fetch_or_404(db, Task, task_id)
    if body.story_id is not None:
        fetch_or_404(db, Story, body.story_id)
    if body.agent_id is not None and body.agent_id != "":
        fetch_or_404(db, Agent, body.agent_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    apply_md_timestamp(task, data)
    for k, v in data.items():
        setattr(task, k, v)
    db.commit()
    ec = _entity_mockup_counts(db)
    return task.to_dict(mockup_count=_owner_mockup_count(ec, "task", task))

@app.delete("/tasks/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Task, task_id)); db.commit()
    return {"deleted": task_id}


# ---------- MOCKUPS (entità di prima classe, story s443652b6) ----------

_HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$", re.MULTILINE)


def _mockup_name(md: str, block_start: int, target_title: str, index: int) -> str:
    """Euristica nome mockup: ultima heading md prima del blocco, fallback "<title> — mockup #<n>"."""
    last_heading = None
    for h in _HEADING_RE.finditer(md, 0, block_start):
        last_heading = h.group(2).strip()
    if last_heading:
        return last_heading
    return f"{target_title} — mockup #{index}"


def _legacy_mockups_for_target(db: Session, target_type: str, target_obj, comment_counts: dict) -> list[dict]:
    """Fallback legacy: deriva i mockup a runtime dai blocchi ```mockup``` nel `md`.

    Usato solo per gli owner (story/task, eventualmente epic in aggregazione) che non
    hanno ancora righe nella tabella `mockups` (pre-backfill). Una volta eseguito lo
    script di backfill (`scripts/backfill_mockups.py`) questo ramo non produce più nulla
    perché `_owner_has_mockup_rows` risulta vero per ogni owner con blocchi nel md.
    """
    md = target_obj.md or ""
    items = []
    for idx, (_content, start_offset) in enumerate(iter_mockup_blocks(md)):
        items.append({
            "target_type": target_type,
            "target_id": target_obj.id,
            "target_title": target_obj.title,
            "mockup_index": idx,
            "name": _mockup_name(md, start_offset, target_obj.title, idx),
            "comment_count": comment_counts.get((target_type, target_obj.id, idx), 0),
        })
    return items


def _comment_counts_legacy(db: Session) -> dict:
    counts: dict = {}
    for c in db.query(MockupComment).filter(MockupComment.target_type.isnot(None)).all():
        key = (c.target_type, c.target_id, c.mockup_index)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _comment_counts_by_mockup(db: Session) -> dict:
    counts: dict = {}
    for c in db.query(MockupComment).filter(MockupComment.mockup_id.isnot(None)).all():
        counts[c.mockup_id] = counts.get(c.mockup_id, 0) + 1
    return counts


def _mockups_for_owner(db: Session, owner_type: str, owner_obj, comment_counts: dict) -> list[dict]:
    """Mockup di un owner: righe in `mockups` se presenti (post-backfill/creati via API),
    altrimenti fallback legacy sui blocchi del `md` (pre-backfill, retrocompat)."""
    rows = (
        db.query(Mockup)
        .filter(Mockup.owner_type == owner_type, Mockup.owner_id == owner_obj.id)
        .order_by(Mockup.position.asc())
        .all()
    )
    if rows:
        out = []
        for m in rows:
            d = m.to_dict()
            d["comment_count"] = comment_counts.get(m.id, 0)
            out.append(d)
        return out
    # Nessuna riga persistita per questo owner: fallback legacy (md non ancora migrata).
    return _legacy_mockups_for_target(db, owner_type, owner_obj, _comment_counts_legacy(db))


@app.get("/mockups")
def list_mockups(
    owner_type: Optional[str] = None,
    owner_id: Optional[str] = None,
    epic_id: Optional[str] = None,
    story_id: Optional[str] = None,
    task_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Retrocompat: `owner_type`+`owner_id` (contratto nuovo) oppure `epic_id`/`story_id`/`task_id`
    (comportamento aggregante preesistente). Esattamente un criterio tra i due stili."""
    if owner_type or owner_id:
        if not (owner_type and owner_id):
            raise HTTPException(422, "specificare sia owner_type sia owner_id")
        validate_status(owner_type, MOCKUP_OWNER, field="owner_type")
        if epic_id or story_id or task_id:
            raise HTTPException(422, "non combinare owner_type/owner_id con epic_id/story_id/task_id")
        model = Story if owner_type == "story" else Task
        owner_obj = fetch_or_404(db, model, owner_id)
        comment_counts = _comment_counts_by_mockup(db)
        return {"mockups": _mockups_for_owner(db, owner_type, owner_obj, comment_counts)}

    filters = [f for f in (epic_id, story_id, task_id) if f]
    if len(filters) != 1:
        raise HTTPException(422, "specificare esattamente uno tra owner_type+owner_id, epic_id, story_id, task_id")

    comment_counts = _comment_counts_by_mockup(db)
    results: list[dict] = []

    if task_id:
        task = fetch_or_404(db, Task, task_id)
        results.extend(_mockups_for_owner(db, "task", task, comment_counts))
    elif story_id:
        story = fetch_or_404(db, Story, story_id)
        results.extend(_mockups_for_owner(db, "story", story, comment_counts))
        for t in db.query(Task).filter(Task.story_id == story.id).all():
            results.extend(_mockups_for_owner(db, "task", t, comment_counts))
    else:
        epic = fetch_or_404(db, Epic, epic_id)
        # I mockup nella md propria dell'epic (D3, legacy-only: Mockup non supporta owner_type=epic)
        # sono inclusi oltre a quelli della discendenza story/task — stesso principio già applicato a Story.
        results.extend(_legacy_mockups_for_target(db, "epic", epic, _comment_counts_legacy(db)))
        for s in db.query(Story).filter(Story.epic_id == epic.id).all():
            results.extend(_mockups_for_owner(db, "story", s, comment_counts))
            for t in db.query(Task).filter(Task.story_id == s.id).all():
                results.extend(_mockups_for_owner(db, "task", t, comment_counts))

    return {"mockups": results}


def _validate_mockup_type_source(type_: str, source: str, ref_url: Optional[str]) -> None:
    """Coerenza applicativa leggera type<->source (non vincolo DB), come da contratto story."""
    if type_ == "html" and source != "embedded":
        raise HTTPException(422, "type=html richiede source=embedded")
    if type_ == "figma":
        if source != "figma":
            raise HTTPException(422, "type=figma richiede source=figma")
        if not ref_url:
            raise HTTPException(422, "type=figma richiede ref_url")
    if type_ == "claude_canvas" and source != "claude":
        raise HTTPException(422, "type=claude_canvas richiede source=claude")
    if type_ == "link" and source != "url":
        raise HTTPException(422, "type=link richiede source=url")


def _fetch_mockup_owner(db: Session, owner_type: str, owner_id: str):
    model = Story if owner_type == "story" else Task
    return fetch_or_404(db, model, owner_id)


@app.post("/mockups", status_code=201)
def create_mockup(body: MockupIn, db: Session = Depends(get_db)):
    validate_status(body.owner_type, MOCKUP_OWNER, field="owner_type")
    validate_status(body.type, MOCKUP_TYPE, field="type")
    validate_status(body.source, MOCKUP_SOURCE, field="source")
    _fetch_mockup_owner(db, body.owner_type, body.owner_id)
    _validate_mockup_type_source(body.type, body.source, body.ref_url)
    now = _now()
    mockup = Mockup(
        id=new_id("mk"), owner_type=body.owner_type, owner_id=body.owner_id,
        title=body.title, type=body.type, source=body.source,
        content=body.content, ref_url=body.ref_url, position=body.position,
        created_at=now, updated_at=now,
    )
    db.add(mockup); db.commit()
    return mockup.to_dict()

@app.get("/mockups/{mockup_id}")
def get_mockup(mockup_id: str, db: Session = Depends(get_db)):
    return fetch_or_404(db, Mockup, mockup_id).to_dict()

@app.patch("/mockups/{mockup_id}")
def update_mockup(mockup_id: str, body: MockupPatch, db: Session = Depends(get_db)):
    validate_status(body.type, MOCKUP_TYPE, field="type")
    validate_status(body.source, MOCKUP_SOURCE, field="source")
    mockup = fetch_or_404(db, Mockup, mockup_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    new_type = data.get("type", mockup.type)
    new_source = data.get("source", mockup.source)
    new_ref_url = data.get("ref_url", mockup.ref_url)
    _validate_mockup_type_source(new_type, new_source, new_ref_url)
    for k, v in data.items():
        setattr(mockup, k, v)
    mockup.updated_at = _now()
    db.commit()
    return mockup.to_dict()

@app.delete("/mockups/{mockup_id}")
def delete_mockup(mockup_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Mockup, mockup_id)); db.commit()
    return {"deleted": mockup_id}


# ---------- MOCKUP COMMENTS ----------

def _validate_comment_image(image: Optional[str]) -> None:
    if image is None:
        return
    if not DATA_URI_IMAGE_PREFIX_RE.match(image):
        raise HTTPException(422, "image deve essere una data URI con prefisso 'data:image/'")
    b64_payload = image.split(",", 1)[1] if "," in image else ""
    try:
        decoded = base64.b64decode(b64_payload, validate=True)
    except Exception:
        raise HTTPException(422, "image non è base64 valido")
    if len(decoded) > MAX_COMMENT_IMAGE_BYTES:
        raise HTTPException(422, f"image supera il limite di {MAX_COMMENT_IMAGE_BYTES} byte")


def _fetch_comment_target(db: Session, target_type: str, target_id: str):
    model = Story if target_type == "story" else Task
    return fetch_or_404(db, model, target_id)


@app.get("/mockup-comments")
def list_mockup_comments(
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    mockup_index: Optional[int] = None,
    mockup_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    validate_status(target_type, TARGET_COMMENT, field="target_type")
    q = db.query(MockupComment)
    if mockup_id:
        q = q.filter(MockupComment.mockup_id == mockup_id)
    if target_type:
        q = q.filter(MockupComment.target_type == target_type)
    if target_id:
        q = q.filter(MockupComment.target_id == target_id)
    if mockup_index is not None:
        q = q.filter(MockupComment.mockup_index == mockup_index)
    q = q.order_by(MockupComment.created_at.asc())
    return [c.to_dict() for c in q.all()]

@app.post("/mockup-comments", status_code=201)
def create_mockup_comment(body: MockupCommentIn, db: Session = Depends(get_db)):
    """Accetta `mockup_id` (preferito, FK applicativa verso l'entità Mockup) oppure,
    in retrocompat, la coppia legacy `target_type`+`target_id`+`mockup_index`."""
    if not (body.text or "").strip() and not body.image:
        raise HTTPException(422, "specificare almeno uno tra text e image")
    _validate_comment_image(body.image)

    if body.mockup_id:
        fetch_or_404(db, Mockup, body.mockup_id)
    elif body.target_type and body.target_id and body.mockup_index is not None:
        validate_status(body.target_type, TARGET_COMMENT, field="target_type")
        _fetch_comment_target(db, body.target_type, body.target_id)
        if body.mockup_index < 0:
            raise HTTPException(422, "mockup_index deve essere >= 0")
    else:
        raise HTTPException(
            422,
            "specificare mockup_id oppure target_type+target_id+mockup_index",
        )

    comment = MockupComment(
        id=new_id("c"), mockup_id=body.mockup_id,
        target_type=body.target_type, target_id=body.target_id,
        mockup_index=body.mockup_index, author=body.author or "user",
        text=body.text or "", image=body.image, created_at=_now(),
    )
    db.add(comment); db.commit()
    return comment.to_dict()

@app.delete("/mockup-comments/{comment_id}")
def delete_mockup_comment(comment_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, MockupComment, comment_id)); db.commit()
    return {"deleted": comment_id}


# ---------- AGENTS ----------

@app.get("/agents")
def list_agents(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Agent)
    if status:
        q = q.filter(Agent.status == status)
    return [a.to_dict() for a in q.all()]

@app.post("/agents", status_code=201)
def create_agent(body: AgentIn, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_AGENT)
    agent = Agent(id=new_id("a"), name=body.name, current_task=body.current_task,
                  status=body.status, tokens=body.tokens)
    db.add(agent); db.commit()
    return agent.to_dict()

@app.get("/agents/{agent_id}")
def get_agent(agent_id: str, db: Session = Depends(get_db)):
    return fetch_or_404(db, Agent, agent_id).to_dict()

@app.patch("/agents/{agent_id}")
def update_agent(agent_id: str, body: AgentPatch, db: Session = Depends(get_db)):
    validate_status(body.status, STATUS_AGENT)
    agent = fetch_or_404(db, Agent, agent_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    for k, v in data.items():
        setattr(agent, k, v)
    db.commit()
    return agent.to_dict()

@app.delete("/agents/{agent_id}")
def delete_agent(agent_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Agent, agent_id)); db.commit()
    return {"deleted": agent_id}


# ---------- DESIGN SYSTEMS (story s2340fc3b: artefatto canonico 1:1 con project) ----------

@app.get("/design-systems")
def list_design_systems(project_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(DesignSystem)
    if project_id:
        q = q.filter(DesignSystem.project_id == project_id)
    return [d.to_dict() for d in q.all()]

@app.post("/design-systems", status_code=201)
def upsert_design_system(body: DesignSystemIn, db: Session = Depends(get_db)):
    """Upsert idempotente per `project_id`: una riga per project (UNIQUE).
    Se esiste già un DesignSystem per quel project, aggiorna invece di
    duplicare — fondamentale perché la skill `sethlans-design` richiama questo
    endpoint a ogni scan del codice."""
    validate_status(body.source, DESIGN_SOURCE, field="source")
    validate_status(body.sync_state, DESIGN_SYNC_STATE, field="sync_state")
    if body.ext_provider is not None:
        validate_status(body.ext_provider, DESIGN_PROVIDER, field="ext_provider")
    fetch_or_404(db, Project, body.project_id)

    now = _now()
    existing = db.query(DesignSystem).filter(DesignSystem.project_id == body.project_id).one_or_none()
    if existing:
        existing.title = body.title
        existing.md = body.md
        existing.tokens = body.tokens
        existing.components = body.components
        existing.source = body.source
        existing.sync_state = body.sync_state
        existing.ext_provider = body.ext_provider
        existing.ext_file_id = body.ext_file_id
        existing.ext_url = body.ext_url
        existing.last_scan_at = body.last_scan_at
        existing.last_sync_at = body.last_sync_at
        existing.updated_at = now
        db.commit()
        return existing.to_dict()

    design_system = DesignSystem(
        id=new_id("ds"), project_id=body.project_id, title=body.title,
        md=body.md, tokens=body.tokens, components=body.components,
        source=body.source, sync_state=body.sync_state,
        ext_provider=body.ext_provider, ext_file_id=body.ext_file_id, ext_url=body.ext_url,
        last_scan_at=body.last_scan_at, last_sync_at=body.last_sync_at,
        created_at=now, updated_at=now,
    )
    db.add(design_system); db.commit()
    return design_system.to_dict()

@app.get("/design-systems/{design_system_id}")
def get_design_system(design_system_id: str, db: Session = Depends(get_db)):
    return fetch_or_404(db, DesignSystem, design_system_id).to_dict()

@app.patch("/design-systems/{design_system_id}")
def update_design_system(design_system_id: str, body: DesignSystemPatch, db: Session = Depends(get_db)):
    validate_status(body.source, DESIGN_SOURCE, field="source")
    validate_status(body.sync_state, DESIGN_SYNC_STATE, field="sync_state")
    if body.ext_provider is not None:
        validate_status(body.ext_provider, DESIGN_PROVIDER, field="ext_provider")
    design_system = fetch_or_404(db, DesignSystem, design_system_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    for k, v in data.items():
        setattr(design_system, k, v)
    design_system.updated_at = _now()
    db.commit()
    return design_system.to_dict()

@app.delete("/design-systems/{design_system_id}")
def delete_design_system(design_system_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, DesignSystem, design_system_id)); db.commit()
    return {"deleted": design_system_id}


# ---------- KNOWLEDGE ----------

@app.get("/knowledge")
def list_knowledge(project_id: Optional[str] = None, role: Optional[str] = None,
                   kind: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Knowledge)
    if project_id:
        q = q.filter(Knowledge.project_id == project_id)
    if role:
        q = q.filter(Knowledge.role == role)
    if kind:
        q = q.filter(Knowledge.kind == kind)
    return [k.to_dict() for k in q.all()]

@app.post("/knowledge", status_code=201)
def create_knowledge(body: KnowledgeIn, db: Session = Depends(get_db)):
    validate_status(body.role, ROLE_KNOWLEDGE, field="role")
    validate_status(body.kind, KIND_KNOWLEDGE, field="kind")
    validate_status(body.source, SOURCE_KNOWLEDGE, field="source")
    fetch_or_404(db, Project, body.project_id)
    card = Knowledge(
        id=new_id("k"), project_id=body.project_id, title=body.title,
        role=body.role, kind=body.kind, source=body.source, md=body.md,
        md_updated_at=_now() if body.md else None,
    )
    db.add(card); db.commit()
    return card.to_dict()

@app.get("/knowledge/{knowledge_id}")
def get_knowledge(knowledge_id: str, db: Session = Depends(get_db)):
    return fetch_or_404(db, Knowledge, knowledge_id).to_dict()

@app.patch("/knowledge/{knowledge_id}")
def update_knowledge(knowledge_id: str, body: KnowledgePatch, db: Session = Depends(get_db)):
    validate_status(body.role, ROLE_KNOWLEDGE, field="role")
    validate_status(body.kind, KIND_KNOWLEDGE, field="kind")
    validate_status(body.source, SOURCE_KNOWLEDGE, field="source")
    card = fetch_or_404(db, Knowledge, knowledge_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    apply_md_timestamp(card, data)
    for k, v in data.items():
        setattr(card, k, v)
    db.commit()
    return card.to_dict()

@app.delete("/knowledge/{knowledge_id}")
def delete_knowledge(knowledge_id: str, db: Session = Depends(get_db)):
    db.delete(fetch_or_404(db, Knowledge, knowledge_id)); db.commit()
    return {"deleted": knowledge_id}


# ---------- SNAPSHOT ----------

@app.get("/state")
def full_state(db: Session = Depends(get_db)):
    epics = db.query(Epic).all()
    stories = db.query(Story).all()
    tasks = db.query(Task).all()

    # Calcola entity_counts una sola volta per intera richiesta (anti-N+1).
    ec = _entity_mockup_counts(db)

    # Aggrego in memoria i riferimenti gerarchici senza ulteriori query (D3, C0).
    tasks_by_story: dict[str, list[Task]] = {}
    for t in tasks:
        tasks_by_story.setdefault(t.story_id, []).append(t)
    stories_by_epic: dict[str, list[Story]] = {}
    for s in stories:
        stories_by_epic.setdefault(s.epic_id, []).append(s)

    return {
        "projects":  [p.to_dict() for p in db.query(Project).all()],
        "epics": [
            e.to_dict(
                mockup_descendant_count=_epic_mockup_descendant_count(
                    e, stories_by_epic.get(e.id, []), tasks_by_story, ec,
                )
            )
            for e in epics
        ],
        "stories": [
            s.to_dict(
                mockup_count=_owner_mockup_count(ec, "story", s),
                mockup_descendant_count=_story_mockup_descendant_count(
                    s, tasks_by_story.get(s.id, []), ec,
                ),
            )
            for s in stories
        ],
        "tasks": [
            t.to_dict(mockup_count=_owner_mockup_count(ec, "task", t)) for t in tasks
        ],
        "agents":         [a.to_dict() for a in db.query(Agent).all()],
        "knowledge":      [k.to_dict() for k in db.query(Knowledge).all()],
        "mockup_comments": [c.to_dict() for c in db.query(MockupComment).all()],
        # Un design system per project (cardinalità 1:1, story s2340fc3b).
        "design_systems": [d.to_dict() for d in db.query(DesignSystem).all()],
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SETHLANS_SERVICE_PORT", "9955"))
    uvicorn.run(app, host="0.0.0.0", port=port)
