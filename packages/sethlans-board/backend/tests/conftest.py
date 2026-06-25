"""Fixture condivise per i test unitari del backend.

Usa SQLite in-memory (no Testcontainers/Postgres: quelli sono di competenza del
seth-tester per la suite di integrazione). Ogni test crea/droppa lo schema su un
engine dedicato per isolare i casi.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from models import Base


@pytest.fixture()
def engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture()
def db_session(engine):
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture()
def client(engine, monkeypatch):
    """TestClient con get_db rediretto sull'engine SQLite in-memory di test."""
    import server

    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

    def _override_get_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    server.app.dependency_overrides[server.get_db] = _override_get_db

    from fastapi.testclient import TestClient
    with TestClient(server.app) as c:
        yield c

    server.app.dependency_overrides.clear()
