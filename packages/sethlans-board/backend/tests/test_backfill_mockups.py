"""Test del backfill one-shot `scripts/backfill_mockups.py` (story `s443652b6`):
estrazione dei blocchi ```mockup``` esistenti nel `md`, idempotenza al re-run,
rimappatura dei MockupComment legacy verso `mockup_id`, gestione orfani (log,
non cancellazione). Integrazione/E2E sono a carico del seth-tester.
"""
from datetime import datetime, timezone

from models import Mockup, MockupComment, Story, Task, new_id
from scripts.backfill_mockups import run

MOCKUP_BLOCK = "```mockup\n<html><body>hi</body></html>\n```"


def _now():
    return datetime.now(timezone.utc)


def _make_story_with_blocks(db_session, n_blocks=2, heading="Story heading"):
    story = Story(
        id=new_id("s"), title="S", status="todo", phase="analysis", epic_id="enotreal",
        md=f"# {heading}\n\n" + (MOCKUP_BLOCK + "\n") * n_blocks,
    )
    db_session.add(story)
    db_session.commit()
    return story


def test_backfill_creates_mockup_per_block(db_session):
    story = _make_story_with_blocks(db_session, n_blocks=2)
    summary = run(db_session)
    assert summary["mockups_created"] == 2
    rows = db_session.query(Mockup).filter(Mockup.owner_id == story.id).order_by(Mockup.position).all()
    assert [r.position for r in rows] == [0, 1]
    assert all(r.type == "html" and r.source == "embedded" for r in rows)
    assert all(r.owner_type == "story" for r in rows)


def test_backfill_title_heuristic_uses_last_heading(db_session):
    story = _make_story_with_blocks(db_session, n_blocks=1, heading="My Heading")
    run(db_session)
    mockup = db_session.query(Mockup).filter(Mockup.owner_id == story.id).one()
    assert mockup.title == "My Heading"


def test_backfill_no_blocks_creates_nothing(db_session):
    story = Story(id=new_id("s"), title="S", status="todo", phase="analysis", epic_id="e1", md="no mockup here")
    db_session.add(story); db_session.commit()
    summary = run(db_session)
    assert summary["mockups_created"] == 0


def test_backfill_is_idempotent_on_rerun(db_session):
    story = _make_story_with_blocks(db_session, n_blocks=3)
    first = run(db_session)
    assert first["mockups_created"] == 3
    second = run(db_session)
    assert second["mockups_created"] == 0  # nessuna duplicazione
    rows = db_session.query(Mockup).filter(Mockup.owner_id == story.id).all()
    assert len(rows) == 3


def test_backfill_covers_tasks_too(db_session):
    task = Task(id=new_id("t"), title="T", status="todo", story_id="snotreal", md=MOCKUP_BLOCK)
    db_session.add(task); db_session.commit()
    summary = run(db_session)
    assert summary["mockups_created"] == 1
    mockup = db_session.query(Mockup).filter(Mockup.owner_id == task.id).one()
    assert mockup.owner_type == "task"


def test_backfill_remaps_legacy_comment_to_mockup_id(db_session):
    story = _make_story_with_blocks(db_session, n_blocks=1)
    comment = MockupComment(
        id=new_id("c"), target_type="story", target_id=story.id, mockup_index=0,
        author="user", text="please fix", created_at=_now(),
    )
    db_session.add(comment); db_session.commit()

    summary = run(db_session)
    assert summary["comments_remapped"] == 1
    assert summary["comments_orphaned"] == 0

    db_session.refresh(comment)
    mockup = db_session.query(Mockup).filter(Mockup.owner_id == story.id, Mockup.position == 0).one()
    assert comment.mockup_id == mockup.id
    # Campi legacy restano intatti per retro-lettura.
    assert comment.target_type == "story"
    assert comment.mockup_index == 0


def test_backfill_logs_orphan_comment_without_deleting(db_session):
    """Un commento che punta a (target_type, target_id, mockup_index) senza blocco
    corrispondente deve restare nel DB (non cancellato), solo loggato come orfano."""
    story = Story(id=new_id("s"), title="S", status="todo", phase="analysis", epic_id="e1", md="no mockup here")
    db_session.add(story); db_session.commit()
    comment = MockupComment(
        id=new_id("c"), target_type="story", target_id=story.id, mockup_index=0,
        author="user", text="orphan", created_at=_now(),
    )
    db_session.add(comment); db_session.commit()

    summary = run(db_session)
    assert summary["comments_orphaned"] == 1
    assert summary["comments_remapped"] == 0

    still_there = db_session.get(MockupComment, comment.id)
    assert still_there is not None
    assert still_there.mockup_id is None


def test_backfill_does_not_modify_md(db_session):
    story = _make_story_with_blocks(db_session, n_blocks=1)
    original_md = story.md
    run(db_session)
    db_session.refresh(story)
    assert story.md == original_md
