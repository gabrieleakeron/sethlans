"""
Alembic env per Sethlans Board — supporta SQLite (default) e PostgreSQL.
Con PostgreSQL: schema dedicato `sethlans_service`, schema_translate_map, version table nello schema.
Con SQLite: nessuna operazione sugli schemi, tabelle nel database direttamente.
"""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool, text

sys.path.append(str(Path(__file__).resolve().parents[1]))

from db import IS_POSTGRES, SCHEMA, SERVICE_DB_URL  # noqa: E402
from models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):
    if IS_POSTGRES and type_ == "table" and object.schema not in (None, SCHEMA):
        return False
    return True


def run_migrations_offline() -> None:
    opts = dict(
        url=SERVICE_DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        include_object=include_object,
    )
    if IS_POSTGRES:
        opts.update(
            dialect_opts={"paramstyle": "named"},
            version_table_schema=SCHEMA,
            include_schemas=True,
        )
    context.configure(**opts)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connect_args = {} if IS_POSTGRES else {"check_same_thread": False}
    connectable = create_engine(SERVICE_DB_URL, poolclass=pool.NullPool, connect_args=connect_args)
    with connectable.connect() as connection:
        if IS_POSTGRES:
            connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
            # search_path: serve a far risolvere nello schema dedicato anche il DDL
            # NON qualificato. Lo schema_translate_map viene applicato solo alle
            # CREATE TABLE, non agli ALTER TABLE (add_column/alter_column, incl. in
            # batch_alter_table), che verrebbero emessi senza schema e fallirebbero
            # con "relation does not exist". Impostarlo qui copre tutte le revisioni.
            connection.execute(text(f"SET search_path TO {SCHEMA}, public"))
            connection.commit()
            connection = connection.execution_options(schema_translate_map={None: SCHEMA})

        opts = dict(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )
        if IS_POSTGRES:
            opts.update(
                version_table_schema=SCHEMA,
                include_schemas=True,
            )
        context.configure(**opts)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
