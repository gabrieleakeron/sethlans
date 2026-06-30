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
    # batch_alter_table serve SOLO a SQLite, che non supporta ALTER COLUMN
    # nativamente (ricostruisce la tabella). Su Postgres NON va usato qui:
    # batch_alter_table NON applica lo schema_translate_map ({None: SCHEMA})
    # configurato in env.py, quindi emette un `ALTER TABLE mockup_comments`
    # non qualificato che — con search_path senza `sethlans_service` — fallisce
    # con "relation does not exist" pur esistendo la tabella nello schema.
    # Le op singole (add_column/alter_column) passano invece per il translate
    # map, esattamente come le create_table che funzionano.
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('mockup_comments') as batch_op:
            batch_op.add_column(sa.Column('mockup_id', sa.String(), nullable=True))
            batch_op.alter_column('target_type', existing_type=sa.VARCHAR(), nullable=True)
            batch_op.alter_column('target_id', existing_type=sa.VARCHAR(), nullable=True)
            batch_op.alter_column('mockup_index', existing_type=sa.INTEGER(), nullable=True)
    else:
        op.add_column('mockup_comments', sa.Column('mockup_id', sa.String(), nullable=True))
        op.alter_column('mockup_comments', 'target_type', existing_type=sa.VARCHAR(), nullable=True)
        op.alter_column('mockup_comments', 'target_id', existing_type=sa.VARCHAR(), nullable=True)
        op.alter_column('mockup_comments', 'mockup_index', existing_type=sa.INTEGER(), nullable=True)


def downgrade() -> None:
    # Vedi nota in upgrade(): batch solo per SQLite, op singole su Postgres
    # (altrimenti lo schema_translate_map non viene applicato).
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('mockup_comments') as batch_op:
            batch_op.alter_column('mockup_index', existing_type=sa.INTEGER(), nullable=False)
            batch_op.alter_column('target_id', existing_type=sa.VARCHAR(), nullable=False)
            batch_op.alter_column('target_type', existing_type=sa.VARCHAR(), nullable=False)
            batch_op.drop_column('mockup_id')
    else:
        op.alter_column('mockup_comments', 'mockup_index', existing_type=sa.INTEGER(), nullable=False)
        op.alter_column('mockup_comments', 'target_id', existing_type=sa.VARCHAR(), nullable=False)
        op.alter_column('mockup_comments', 'target_type', existing_type=sa.VARCHAR(), nullable=False)
        op.drop_column('mockup_comments', 'mockup_id')
    op.drop_table('mockups')
