"""
Seed opzionale di Board (NON eseguito all'avvio).
Crea i 7 agent canonici dei subagent + alcuni dati demo.
Uso:  python seed.py
"""

from db import SessionLocal
from models import Agent, Epic, Project, Story, new_id

CANONICAL_AGENTS = [
    "seth-product-owner", "seth-ux-designer", "seth-architect", "seth-frontend",
    "seth-be-python", "seth-be-java", "seth-fullstack", "seth-reviewer", "seth-tester",
]


def run():
    s = SessionLocal()
    try:
        existing = {a.name for a in s.query(Agent).all()}
        for name in CANONICAL_AGENTS:
            if name not in existing:
                s.add(Agent(id=new_id("a"), name=name, current_task="Inattivo",
                            status="idle", tokens=0))
        # progetto di default (riusa quello creato dalla migrazione se presente)
        project = s.query(Project).first()
        if project is None:
            project = Project(id=new_id("p"), name="Demo", type="internal", jira_key="")
            s.add(project)
            s.flush()
        if s.query(Epic).count() == 0:
            epic = Epic(id=new_id("e"), title="Demo", desc="Epica di esempio",
                        status="progress", project_id=project.id,
                        md="# Demo\nEpica di esempio.")
            s.add(epic)
            s.flush()
            s.add(Story(id=new_id("s"), title="Storia demo", desc="Storia di esempio",
                        status="todo", phase="analysis", epic_id=epic.id,
                        md="# Storia demo\nAnalisi di esempio."))
        s.commit()
        print("Seed completato.")
    finally:
        s.close()


if __name__ == "__main__":
    run()
