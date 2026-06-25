"""add mockups table and mockup_comments.mockup_id

Revision ID: e7733e465fcb
Revises: d2f055479530
Create Date: 2026-06-22 13:47:40.089338

Story `s443652b6`: entità Mockup di prima classe (tabella `mockups`) + FK
applicativa `mockup_comments.mockup_id` verso di essa. I legacy
`target_type`/`target_id`/`mockup_index` di `mockup_comments` diventano
nullable (i nuovi commenti li lasciano vuoti e usano solo `mockup_id`; i
commenti pre-esistenti restano leggibili in retrocompat).

Nota: come nella revisione precedente (`d2f055479530`), l'autogenerate ha
anche rilevato drift di NOT NULL/indice preesistenti su altre tabelle
(agents.current_task, epics.desc/md, knowledge ix_project_id, projects.jira_key,
stories.desc/md, tasks.md) non legato a questa modifica — rimossi da questa
revision per restare focalizzata sullo scope della story.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7733e465fcb'
down_revision = 'd2f055479530'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'mockups',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('owner_type', sa.String(), nullable=False),
        sa.Column('owner_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('type', sa.String(), server_default='html', nullable=False),
        sa.Column('source', sa.String(), server_default='embedded', nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('ref_url', sa.String(), nullable=True),
        sa.Column('position', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    # batch_alter_table: necessario per SQLite, che non supporta
    # ALTER TABLE ... ALTER COLUMN nativamente (ricostruisce la tabella);
    # su Postgres si comporta come le singole alter_column equivalenti.
    with op.batch_alter_table('mockup_comments') as batch_op:
        batch_op.add_column(sa.Column('mockup_id', sa.String(), nullable=True))
        batch_op.alter_column('target_type',
                   existing_type=sa.VARCHAR(),
                   nullable=True)
        batch_op.alter_column('target_id',
                   existing_type=sa.VARCHAR(),
                   nullable=True)
        batch_op.alter_column('mockup_index',
                   existing_type=sa.INTEGER(),
                   nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('mockup_comments') as batch_op:
        batch_op.alter_column('mockup_index',
                   existing_type=sa.INTEGER(),
                   nullable=False)
        batch_op.alter_column('target_id',
                   existing_type=sa.VARCHAR(),
                   nullable=False)
        batch_op.alter_column('target_type',
                   existing_type=sa.VARCHAR(),
                   nullable=False)
        batch_op.drop_column('mockup_id')
    op.drop_table('mockups')
