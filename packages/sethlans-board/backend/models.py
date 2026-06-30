"""
Sethlans Board — Modelli ORM (SQLAlchemy 2.0)
==============================================
Schema dati condiviso tra l'app FastAPI (`server.py`) e le migrazioni
Alembic (`alembic/env.py`). Le tabelle non dichiarano lo schema: viene tradotto a
runtime su `sethlans_service` tramite `schema_translate_map` (vedi `db.py` e `alembic/env.py`).
"""

import re
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Enum applicativi (validati nell'API)
STATUS_WORK = {"todo", "progress", "done"}      # epiche, storie, task
STATUS_AGENT = {"active", "idle"}               # agenti
PHASE_STORY = {"analysis", "ux", "design", "dev", "done"}  # fase del flusso (storie)
TYPE_PROJECT = {"jira", "internal"}             # progetto Jira o interno
TARGET_COMMENT = {"story", "task"}              # target polimorfico dei commenti sui mockup (legacy)
MOCKUP_OWNER = {"story", "task"}                # owner polimorfico dell'entità Mockup
MOCKUP_TYPE = {"html", "image", "figma", "claude_canvas", "link"}   # provider/tipo del mockup
MOCKUP_SOURCE = {"embedded", "upload", "figma", "claude", "url"}    # origine del contenuto
DESIGN_SOURCE = {"code_scan", "manual"}                 # provenienza dell'artefatto DesignSystem
DESIGN_SYNC_STATE = {"local", "synced", "sync_failed"}  # esito ultima proiezione verso il sistema esterno (Penpot)
DESIGN_PROVIDER = {"penpot"}                            # sistema esterno enum-like (NULL = fallback Board-only)

# Parser line-based dei blocchi ```mockup``` nei documenti md — deve rispecchiare
# `splitMockups` in frontend/src/components/shared.jsx per restare coerente
# (conteggio + estrazione). NON usare una regex single-pass: una regex non-greedy
# rischia falsi positivi quando la stringa letterale "```mockup" compare nel
# CONTENUTO di un blocco già aperto (es. copy di empty-state), aprendo blocchi
# fantasma. Semantica (identica BE/FE):
#   - apertura = una riga che, dopo strip(), inizia con "```mockup" (info-string
#     dopo "mockup" ammessa e ignorata); niente apertura se già dentro un blocco.
#   - chiusura = la PRIMA riga successiva che, dopo strip(), è esattamente "```".
#   - il contenuto tra le due righe è opaco: occorrenze di "```mockup"/"```"
#     *inline dentro una riga* non aprono/chiudono nulla, solo righe-fence intere.
#   - fence non chiusa a fine documento: il blocco viene chiuso a EOF (si
#     preferisce non perdere contenuto rispetto a scartarlo silenziosamente).
_MOCKUP_OPEN_PREFIX = "```mockup"
_MOCKUP_CLOSE_LINE = "```"


def iter_mockup_blocks(md: str | None) -> list[tuple[str, int]]:
    """Estrae i blocchi ```mockup``` reali da un documento md.

    Ritorna una lista di tuple (content, start_offset) dove `start_offset` è
    l'offset (in caratteri) della riga di apertura della fence nel documento
    originale — usato da `_mockup_name` per individuare l'ultima heading utile.
    """
    if not md:
        return []
    blocks: list[tuple[str, int]] = []
    lines = md.splitlines(keepends=True)
    offset = 0
    in_block = False
    block_start_offset = 0
    content_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not in_block:
            if stripped.startswith(_MOCKUP_OPEN_PREFIX):
                in_block = True
                block_start_offset = offset
                content_lines = []
        else:
            if stripped == _MOCKUP_CLOSE_LINE:
                blocks.append(("".join(content_lines), block_start_offset))
                in_block = False
            else:
                content_lines.append(line)
        offset += len(line)
    if in_block:
        # Fence non chiusa a fine documento: si chiude a EOF per non perdere il contenuto.
        blocks.append(("".join(content_lines), block_start_offset))
    return blocks


def count_mockups(md: str | None) -> int:
    """Conta i blocchi ```mockup``` reali in un documento md (D3)."""
    return len(iter_mockup_blocks(md))

# --- Knowledge cards (profilo progetto + KB del pre-training, vedi sethlans-onboard) ---
# role: a quale subagent/ambito serve la card; "general" = trasversale.
ROLE_KNOWLEDGE = {
    "general", "po", "seth-architect", "ux", "seth-tester",
    "seth-frontend", "seth-be-python", "seth-be-java", "seth-fullstack", "seth-reviewer", "seth-devops",
}
# kind: profile = specchio di CLAUDE.md/config; kb = conoscenza estratta; learnings = appresi a runtime.
KIND_KNOWLEDGE = {"profile", "kb", "learnings"}
# source: da dove proviene il contenuto.
SOURCE_KNOWLEDGE = {"claude_md", "confluence", "jira", "code", "manual"}


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False, default="internal", server_default="internal")
    # chiave del progetto Jira (es. "ABC"); vuota per i progetti interni
    jira_key: Mapped[str] = mapped_column(String, default="", server_default="")
    # profilo consultabile (specchio di CLAUDE.md + pack), gestito da /sethlans-onboard
    md: Mapped[str] = mapped_column(Text, default="", server_default="")
    md_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # puntatori strutturati per-ruolo (Confluence space, design-system, ambienti di test, ...)
    config: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "jira_key": self.jira_key or "",
            "md": self.md or "",
            "md_updated_at": self.md_updated_at.isoformat() if self.md_updated_at else None,
            "config": self.config or {},
        }


class Epic(Base):
    __tablename__ = "epics"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    desc: Mapped[str] = mapped_column("desc", Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="todo", server_default="todo")
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    md: Mapped[str] = mapped_column(Text, default="", server_default="")
    md_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self, mockup_descendant_count: int = 0) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "desc": self.desc or "",
            "status": self.status,
            "project_id": self.project_id,
            "md": self.md or "",
            "md_updated_at": self.md_updated_at.isoformat() if self.md_updated_at else None,
            # Derivato (D3, C0): read-only, calcolato a runtime, non persistito.
            "mockup_descendant_count": mockup_descendant_count,
        }


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    current_task: Mapped[str] = mapped_column(String, default="Inattivo", server_default="Inattivo")
    status: Mapped[str] = mapped_column(String, nullable=False, default="idle", server_default="idle")
    tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "current_task": self.current_task,
            "status": self.status,
            "tokens": self.tokens,
        }


class Story(Base):
    __tablename__ = "stories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    desc: Mapped[str] = mapped_column("desc", Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="todo", server_default="todo")
    phase: Mapped[str] = mapped_column(String, nullable=False, default="analysis", server_default="analysis")
    epic_id: Mapped[str] = mapped_column(
        String, ForeignKey("epics.id", ondelete="CASCADE"), nullable=False
    )
    md: Mapped[str] = mapped_column(Text, default="", server_default="")
    md_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self, mockup_count: int | None = None, mockup_descendant_count: int | None = None) -> dict:
        # mockup_count: passato da server.py usando _owner_mockup_count; se None, fallback legacy.
        own = count_mockups(self.md) if mockup_count is None else mockup_count
        return {
            "id": self.id,
            "title": self.title,
            "desc": self.desc or "",
            "status": self.status,
            "phase": self.phase,
            "epic_id": self.epic_id,
            "md": self.md or "",
            "md_updated_at": self.md_updated_at.isoformat() if self.md_updated_at else None,
            # Derivati (D3, C0): read-only, calcolati a runtime, non persistiti.
            "mockup_count": own,
            "mockup_descendant_count": own if mockup_descendant_count is None else mockup_descendant_count,
        }


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="todo", server_default="todo")
    story_id: Mapped[str] = mapped_column(
        String, ForeignKey("stories.id", ondelete="CASCADE"), nullable=False
    )
    agent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True
    )
    md: Mapped[str] = mapped_column(Text, default="", server_default="")
    md_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self, mockup_count: int | None = None) -> dict:
        # mockup_count: passato da server.py usando _owner_mockup_count; se None, fallback legacy.
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "story_id": self.story_id,
            "agent_id": self.agent_id,
            "md": self.md or "",
            "md_updated_at": self.md_updated_at.isoformat() if self.md_updated_at else None,
            # Derivato (D3, C0): read-only, calcolato a runtime, non persistito.
            "mockup_count": count_mockups(self.md) if mockup_count is None else mockup_count,
        }


class Knowledge(Base):
    """Card di conoscenza di progetto (profilo + KB del pre-training).

    Appesa a un Project, indirizzata a un ruolo/subagent. Gli agenti la leggono
    a inizio task; il pre-training (`/sethlans-onboard`) la crea/aggiorna.
    """
    __tablename__ = "knowledge"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False, default="general", server_default="general")
    kind: Mapped[str] = mapped_column(String, nullable=False, default="kb", server_default="kb")
    title: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False, default="manual", server_default="manual")
    md: Mapped[str] = mapped_column(Text, default="", server_default="")
    md_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "role": self.role,
            "kind": self.kind,
            "title": self.title,
            "source": self.source,
            "md": self.md or "",
            "md_updated_at": self.md_updated_at.isoformat() if self.md_updated_at else None,
        }


class Mockup(Base):
    """Entità di prima classe per i mockup (story `s443652b6`).

    Sostituisce i blocchi ```mockup``` embedded nel `md` come sorgente di
    verità: owner polimorfico (story|task) con integrità applicativa
    (`fetch_or_404`, come `MockupComment`), `type`/`source` aperti a provider
    futuri (image, figma, claude_canvas, link) senza migrazioni invasive.
    Niente `__table_args__={"schema": ...}`: schema implicito via
    `schema_translate_map` (vedi `db.py`/`alembic/env.py`).
    """
    __tablename__ = "mockups"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False, default="html", server_default="html")
    source: Mapped[str] = mapped_column(String, nullable=False, default="embedded", server_default="embedded")
    # HTML embedded o data URI (image); opaco per il backend, interpretato dal FE in base a `type`.
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # URL esterno per i provider che non incorporano il contenuto (figma/claude/link).
    ref_url: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "owner_type": self.owner_type,
            "owner_id": self.owner_id,
            "title": self.title,
            "type": self.type,
            "source": self.source,
            "content": self.content,
            "ref_url": self.ref_url,
            "position": self.position,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class DesignSystem(Base):
    """Design system di progetto (story `s2340fc3b`): artefatto canonico 1:1 con
    `project` (`project_id` UNIQUE), generato dalla skill `sethlans-design` per
    inferenza dal codice (token + inventario componenti) e opzionalmente
    proiettato push-only su un sistema esterno (default Penpot).

    Direzione di verità decisa dal seth-architect: codice > Board (questa
    entità, canonica) > Penpot (proiezione). Niente round-trip da Penpot.
    Owner = project con cardinalità 1:1 (non polimorfico come `Mockup`).
    Niente `__table_args__={"schema": ...}`: schema implicito via
    `schema_translate_map` (vedi `db.py`/`alembic/env.py`).
    """
    __tablename__ = "design_systems"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    title: Mapped[str] = mapped_column(String, nullable=False, default="Design System", server_default="Design System")
    # Specifiche consultabili: tabella token + linee guida + preview (stesso pattern md+render della Board).
    md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Payload JSON opachi lato DB (colors/typography/spacing/radius; inventario componenti L2).
    tokens: Mapped[str | None] = mapped_column(Text, nullable=True)
    components: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="code_scan", server_default="code_scan")
    sync_state: Mapped[str] = mapped_column(String, nullable=False, default="local", server_default="local")
    # Riferimento esterno Penpot (tutti NULL nel fallback Board-only).
    ext_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    ext_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    ext_url: Mapped[str | None] = mapped_column(String, nullable=True)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "title": self.title,
            "md": self.md,
            "tokens": self.tokens,
            "components": self.components,
            "source": self.source,
            "sync_state": self.sync_state,
            "ext_provider": self.ext_provider,
            "ext_file_id": self.ext_file_id,
            "ext_url": self.ext_url,
            "last_scan_at": self.last_scan_at.isoformat() if self.last_scan_at else None,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class MockupComment(Base):
    """Commento annotato (testo + immagine opzionale) su un mockup di story/task
    (D1: nuova entità board, non nella md — la md è riscritta dagli agenti e
    perderebbe i commenti). Da `s443652b6`: il legame preferito è `mockup_id`
    (FK applicativa verso `Mockup.id`, resistente alla riscrittura del `md`);
    `target_type/target_id/mockup_index` restano nullable per retro-lettura
    dei commenti creati prima della migrazione a entità Mockup.
    """
    __tablename__ = "mockup_comments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    # Legacy (pre s443652b6): target polimorfico posizionale. Nullable per i nuovi commenti.
    target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    target_id: Mapped[str | None] = mapped_column(String, nullable=True)
    mockup_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Preferito: FK applicativa verso Mockup.id (nullable solo per retro-lettura dei commenti legacy).
    mockup_id: Mapped[str | None] = mapped_column(String, nullable=True)
    author: Mapped[str] = mapped_column(String, nullable=False, default="user", server_default="user")
    text: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Data URI base64 (prefisso "data:image/"); D2: niente blob/file endpoint nel primo rilascio.
    image: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "mockup_index": self.mockup_index,
            "mockup_id": self.mockup_id,
            "author": self.author,
            "text": self.text or "",
            "image": self.image,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
