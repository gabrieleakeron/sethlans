"""mockup comments

Revision ID: d2f055479530
Revises: 0001_init
Create Date: 2026-06-20 12:52:19.670195
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd2f055479530'
down_revision = '0001_init'
branch_labels = None
depends_on = None

# Nota: l'autogenerate ha anche rilevato diff di NOT NULL/indice preesistenti su altre
# tabelle (drift tra modelli e 0001_init non legato a questa modifica) — rimossi da questa
# revision per restare focalizzata sulla nuova tabella `mockup_comments` (D1/D2 del contratto).


def upgrade() -> None:
    op.create_table(
        'mockup_comments',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('target_type', sa.String(), nullable=False),
        sa.Column('target_id', sa.String(), nullable=False),
        sa.Column('mockup_index', sa.Integer(), nullable=False),
        sa.Column('author', sa.String(), server_default='user', nullable=False),
        sa.Column('text', sa.Text(), server_default='', nullable=False),
        sa.Column('image', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('mockup_comments')
