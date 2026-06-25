"""Backfill one-shot idempotente: blocchi ```mockup``` nel `md` -> entità `Mockup`.

Story `s443652b6` / task `t7f8fea78`. Estrae i blocchi mockup reali da ogni Story e
Task con `md` non vuoto usando `iter_mockup_blocks` (il parser line-based corretto
dal fix `sd24b70aa`/`t80e75e4f` — NON la vecchia regex `count_mockups`/`splitMockups`)
e li persiste come record `Mockup(type=html, source=embedded)`. Rimappa inoltre ogni
`MockupComment` legacy (`target_type`/`target_id`/`mockup_index`) al `Mockup` creato
nella stessa posizione, impostando `mockup_id`.

USO MANUALE — NON fa parte della migrazione Alembic automatica:
    cd packages/sethlans-board/backend
    SETHLANS_SERVICE_DB_URL=postgresql+psycopg2://... python -m scripts.backfill_mockups
(o senza env var per usare il default sqlite locale, in dev)

Prerequisito: la revisione Alembic `e7733e465fcb` (tabella `mockups` +
`mockup_comments.mockup_id`) deve già essere applicata (`alembic upgrade head`).

Idempotenza: la chiave naturale (owner_type, owner_id, position) viene verificata
prima di ogni insert — se esiste già un `Mockup` con quella chiave per quell'owner,
il blocco viene saltato (non duplicato). Eseguire lo script più volte (anche su
ambienti diversi) è quindi sicuro.

Sicurezza dati: gli orfani (MockupComment senza un Mockup corrispondente alla stessa
posizione) vengono SOLO loggati, mai cancellati. I blocchi ```mockup``` nel `md`
NON vengono rimossi/modificati: restano inerti (il renderer post-migrazione legge
dall'entità, non più dal md) ma il contenuto originale non si perde mai.
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import Session

from db import SessionLocal
from models import Mockup, MockupComment, Story, Task, iter_mockup_blocks, new_id

logger = logging.getLogger("backfill_mockups")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

_HEADING_PREFIX = ("#", "##", "###", "####")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _mockup_title(md: str, block_start: int, owner_title: str, index: int) -> str:
    """Stessa euristica di `_mockup_name` in server.py: ultima heading prima del
    blocco, fallback "<owner_title> — mockup #<n>"."""
    last_heading = None
    offset = 0
    for line in md.splitlines(keepends=True):
        if offset >= block_start:
            break
        stripped = line.strip()
        for prefix in _HEADING_PREFIX:
            if stripped.startswith(prefix + " ") or stripped == prefix:
                last_heading = stripped.lstrip("#").strip()
                break
        offset += len(line)
    return last_heading or f"{owner_title} — mockup #{index}"


def _existing_positions(db: Session, owner_type: str, owner_id: str) -> set[int]:
    rows = (
        db.query(Mockup.position)
        .filter(Mockup.owner_type == owner_type, Mockup.owner_id == owner_id)
        .all()
    )
    return {r[0] for r in rows}


def _backfill_owner(db: Session, owner_type: str, owner_obj) -> int:
    """Crea i record Mockup mancanti per un owner (story|task). Ritorna quanti ne ha creati."""
    md = owner_obj.md or ""
    blocks = iter_mockup_blocks(md)
    if not blocks:
        return 0
    already = _existing_positions(db, owner_type, owner_obj.id)
    created = 0
    now = _now()
    for idx, (content, start_offset) in enumerate(blocks):
        if idx in already:
            continue  # idempotenza: già migrato in un run precedente
        title = _mockup_title(md, start_offset, owner_obj.title, idx)
        db.add(Mockup(
            id=new_id("mk"), owner_type=owner_type, owner_id=owner_obj.id,
            title=title, type="html", source="embedded",
            content=content, ref_url=None, position=idx,
            created_at=now, updated_at=now,
        ))
        created += 1
    return created


def _remap_comments(db: Session) -> tuple[int, int]:
    """Imposta `mockup_id` sui MockupComment legacy che matchano un Mockup per
    (owner_type==target_type, owner_id==target_id, position==mockup_index).
    Ritorna (rimappati, orfani). Gli orfani vengono solo loggati."""
    remapped = 0
    orphans = 0
    comments = (
        db.query(MockupComment)
        .filter(MockupComment.mockup_id.is_(None), MockupComment.target_type.isnot(None))
        .all()
    )
    for c in comments:
        mockup = (
            db.query(Mockup)
            .filter(
                Mockup.owner_type == c.target_type,
                Mockup.owner_id == c.target_id,
                Mockup.position == c.mockup_index,
            )
            .one_or_none()
        )
        if mockup is None:
            orphans += 1
            logger.warning(
                "Orfano: MockupComment %s (target_type=%s, target_id=%s, mockup_index=%s) "
                "senza Mockup corrispondente — NON cancellato, resta leggibile via i campi legacy.",
                c.id, c.target_type, c.target_id, c.mockup_index,
            )
            continue
        c.mockup_id = mockup.id
        remapped += 1
    return remapped, orphans


def run(db: Session) -> dict:
    created_total = 0
    for story in db.query(Story).all():
        created_total += _backfill_owner(db, "story", story)
    for task in db.query(Task).all():
        created_total += _backfill_owner(db, "task", task)
    db.flush()
    remapped, orphans = _remap_comments(db)
    db.commit()
    summary = {"mockups_created": created_total, "comments_remapped": remapped, "comments_orphaned": orphans}
    logger.info("Backfill completato: %s", summary)
    return summary


def main() -> None:
    db = SessionLocal()
    try:
        run(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
