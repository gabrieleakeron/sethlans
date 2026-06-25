"""init sethlans_service schema (projects, epics, agents, stories, tasks, knowledge)

Revision ID: 0001_init
Revises:
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

from db import SCHEMA

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None

# Lo schema è applicato via schema_translate_map (None -> "sethlans_service") in
# env.py per create_table; le operazioni ALTER/INSERT non lo applicano, quindi le
# indicano esplicitamente con schema=SCHEMA.

_DEFAULT_ID = "pdefault0"  # id stabile del progetto di default


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.String(), server_default="internal", nullable=False),
        sa.Column("jira_key", sa.String(), server_default="", nullable=True),
        sa.Column("md", sa.Text(), server_default="", nullable=False),
        sa.Column("md_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("config", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
    )
    op.create_table(
        "epics",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("desc", sa.Text(), server_default="", nullable=True),
        sa.Column("status", sa.String(), server_default="todo", nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("md", sa.Text(), server_default="", nullable=True),
        sa.Column("md_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "agents",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("current_task", sa.String(), server_default="Inattivo", nullable=True),
        sa.Column("status", sa.String(), server_default="idle", nullable=False),
        sa.Column("tokens", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_table(
        "stories",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("desc", sa.Text(), server_default="", nullable=True),
        sa.Column("status", sa.String(), server_default="todo", nullable=False),
        sa.Column("phase", sa.String(), server_default="analysis", nullable=False),
        sa.Column("epic_id", sa.String(), nullable=False),
        sa.Column("md", sa.Text(), server_default="", nullable=True),
        sa.Column("md_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["epic_id"], ["epics.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="todo", nullable=False),
        sa.Column("story_id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=True),
        sa.Column("md", sa.Text(), server_default="", nullable=True),
        sa.Column("md_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
    )
    op.create_table(
        "knowledge",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(), server_default="general", nullable=False),
        sa.Column("kind", sa.String(), server_default="kb", nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("source", sa.String(), server_default="manual", nullable=False),
        sa.Column("md", sa.Text(), server_default="", nullable=False),
        sa.Column("md_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_knowledge_project_id", "knowledge", ["project_id"], schema=SCHEMA)

    # progetto interno di default
    projects = sa.table(
        "projects",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("type", sa.String),
        sa.column("jira_key", sa.String),
        schema=SCHEMA,
    )
    op.bulk_insert(
        projects,
        [{"id": _DEFAULT_ID, "name": "Default", "type": "internal", "jira_key": ""}],
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_project_id", table_name="knowledge", schema=SCHEMA)
    op.drop_table("knowledge")
    op.drop_table("tasks")
    op.drop_table("stories")
    op.drop_table("agents")
    op.drop_table("epics")
    op.drop_table("projects")
