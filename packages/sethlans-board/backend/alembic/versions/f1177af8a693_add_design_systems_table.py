"""add design_systems table

Revision ID: f1177af8a693
Revises: e7733e465fcb
Create Date: 2026-06-25 08:50:01.141336

Story `s2340fc3b`: entità `DesignSystem`, artefatto canonico 1:1 con `project`
(`project_id` UNIQUE), generato dalla skill `sethlans-design`. `tokens`/
`components` sono payload JSON opachi lato DB (colonna Text).

Nota: come nelle revisioni precedenti (`d2f055479530`, `e7733e465fcb`),
l'autogenerate ha anche rilevato drift di NOT NULL/indice preesistenti su
altre tabelle (agents.current_task, epics.desc/md, knowledge ix_project_id,
projects.jira_key, stories.desc/md, tasks.md) non legato a questa modifica —
rimossi da questa revision per restare focalizzata sullo scope della story.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1177af8a693'
down_revision = 'e7733e465fcb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'design_systems',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('project_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), server_default='Design System', nullable=False),
        sa.Column('md', sa.Text(), nullable=True),
        sa.Column('tokens', sa.Text(), nullable=True),
        sa.Column('components', sa.Text(), nullable=True),
        sa.Column('source', sa.String(), server_default='code_scan', nullable=False),
        sa.Column('sync_state', sa.String(), server_default='local', nullable=False),
        sa.Column('ext_provider', sa.String(), nullable=True),
        sa.Column('ext_file_id', sa.String(), nullable=True),
        sa.Column('ext_url', sa.String(), nullable=True),
        sa.Column('last_scan_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id'),
    )


def downgrade() -> None:
    op.drop_table('design_systems')
