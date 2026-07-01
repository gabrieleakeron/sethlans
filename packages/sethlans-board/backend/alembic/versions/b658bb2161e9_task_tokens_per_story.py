"""task tokens per-story

Revision ID: b658bb2161e9
Revises: f1177af8a693
Create Date: 2026-07-01 10:36:25.534309

Story `s36b99979`: nuova colonna `Task.tokens` (Integer NOT NULL default 0),
usata per aggregare i token consumati per (agent x storia) via GROUP BY sui
task della storia (`GET /stories/{id}/agent-tokens`). Il cumulativo globale
`Agent.tokens` resta invariato. Retrocompatibile: server_default "0", nessun
backfill necessario (i task esistenti partono da 0).

Nota: come nelle revisioni precedenti (`d2f055479530`, `e7733e465fcb`,
`f1177af8a693`), l'autogenerate ha anche rilevato drift di NOT NULL/indice/
schema preesistenti su altre tabelle (drop/recreate di projects, epics,
stories, agents, tasks, knowledge, mockups, mockup_comments, design_systems,
alembic_version, NOT NULL su agents.current_task/epics.desc/epics.md/
projects.jira_key/stories.desc/stories.md/tasks.md) non legato a questa
modifica — rimossi da questa revision per restare focalizzata sullo scope
della story.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b658bb2161e9'
down_revision = 'f1177af8a693'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('tokens', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('tasks', 'tokens')
